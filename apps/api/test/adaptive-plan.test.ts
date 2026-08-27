import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTask, createTestHarness, type TestHarness } from './harness.js';

describe('adaptive plan proposal workflow', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  async function preview() {
    return harness.app.inject({
      method: 'POST',
      url: '/api/v1/ai/plan-preview',
      payload: {
        windows: [{
          id: 'morning',
          start: '2026-08-21T02:00:00.000Z',
          end: '2026-08-21T06:00:00.000Z',
        }],
      },
    });
  }

  it('previews without mutation and applies only after human acceptance', async () => {
    const before = await createTask(harness.app, {
      title: 'Prepare', estimatedMinutes: 60,
    });
    const after = await createTask(harness.app, {
      title: 'Deliver', estimatedMinutes: 60, deadline: '2026-08-21T05:00:00.000Z',
    });
    await harness.app.inject({
      method: 'POST', url: `/api/v1/tasks/${after.id}/dependencies`,
      payload: { predecessorId: before.id },
    });

    const response = await preview();
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.proposal.status).toBe('ready');
    expect(body.proposal.assignments.map((item: { taskId: string }) => item.taskId)).toEqual([
      before.id, after.id,
    ]);
    expect(harness.database.store.tasks.get(before.tenantId, before.id)?.startAt).toBeNull();

    const accepted = await harness.app.inject({
      method: 'POST', url: `/api/v1/cards/${body.card.id}/decision`,
      payload: { decision: 'accept' },
    });
    expect(accepted.statusCode).toBe(200);
    const scheduledBefore = harness.database.store.tasks.get(before.tenantId, before.id);
    const scheduledAfter = harness.database.store.tasks.get(after.tenantId, after.id);
    expect(scheduledBefore?.startAt).toBe('2026-08-21T02:00:00.000Z');
    expect(Date.parse(scheduledBefore?.endAt ?? '')).toBeLessThanOrEqual(
      Date.parse(scheduledAfter?.startAt ?? ''),
    );
  });

  it('rejects stale proposals without partially scheduling other tasks', async () => {
    const first = await createTask(harness.app, { title: 'First', estimatedMinutes: 30 });
    const second = await createTask(harness.app, { title: 'Second', estimatedMinutes: 30 });
    const body = (await preview()).json();
    await harness.app.inject({
      method: 'PATCH', url: `/api/v1/tasks/${second.id}`,
      payload: { version: second.version, patch: { title: 'Second changed' } },
    });

    const accepted = await harness.app.inject({
      method: 'POST', url: `/api/v1/cards/${body.card.id}/decision`,
      payload: { decision: 'accept' },
    });
    expect(accepted.statusCode).toBe(400);
    expect(harness.database.store.tasks.get(first.tenantId, first.id)?.startAt).toBeNull();
    expect(harness.database.store.tasks.get(second.tenantId, second.id)?.startAt).toBeNull();
  });

  it('does not allow an infeasible observation card to mutate tasks', async () => {
    const hard = await createTask(harness.app, {
      title: 'Impossible', estimatedMinutes: 180, deadline: '2026-08-21T03:00:00.000Z',
    });
    const body = (await harness.app.inject({
      method: 'POST', url: '/api/v1/ai/plan-preview',
      payload: { windows: [{
        id: 'short', start: '2026-08-21T02:00:00.000Z', end: '2026-08-21T03:00:00.000Z',
      }] },
    })).json();
    expect(body.proposal.status).toBe('infeasible');

    const accepted = await harness.app.inject({
      method: 'POST', url: `/api/v1/cards/${body.card.id}/decision`,
      payload: { decision: 'accept' },
    });
    expect(accepted.statusCode).toBe(400);
    expect(harness.database.store.tasks.get(hard.tenantId, hard.id)?.startAt).toBeNull();
  });

  it('creates a validated subtask graph only after breakdown acceptance', async () => {
    const parent = await createTask(harness.app, { title: 'Launch' });
    const preview = await harness.app.inject({
      method: 'POST', url: '/api/v1/ai/breakdown-preview',
      payload: {
        parentTaskId: parent.id,
        parentVersion: parent.version,
        objective: '完成一次可验证的产品发布',
        subtasks: [
          {
            clientId: 'prepare', title: '准备发布清单',
            definitionOfDone: '清单有负责人和验收标准', estimatedMinutes: 30,
          },
          {
            clientId: 'ship', title: '执行生产发布',
            definitionOfDone: '生产健康检查通过', estimatedMinutes: 60,
            dependsOn: ['prepare'],
          },
        ],
      },
    });
    expect(preview.statusCode).toBe(200);
    expect((await harness.app.inject({
      method: 'GET', url: `/api/v1/tasks/${parent.id}/subtasks`,
    })).json().items).toHaveLength(0);

    const card = preview.json().card;
    const accepted = await harness.app.inject({
      method: 'POST', url: `/api/v1/cards/${card.id}/decision`,
      payload: { decision: 'accept' },
    });
    expect(accepted.statusCode).toBe(200);
    const children = (await harness.app.inject({
      method: 'GET', url: `/api/v1/tasks/${parent.id}/subtasks`,
    })).json().items;
    expect(children.map((item: { title: string }) => item.title)).toEqual([
      '准备发布清单', '执行生产发布',
    ]);
    const ship = children.find((item: { title: string }) => item.title === '执行生产发布');
    const dependencies = (await harness.app.inject({
      method: 'GET', url: `/api/v1/tasks/${ship.id}/dependencies`,
    })).json();
    expect(dependencies.predecessors).toHaveLength(1);
  });

  it('rejects a breakdown when the parent changed after preview', async () => {
    const parent = await createTask(harness.app, { title: 'Original' });
    const body = (await harness.app.inject({
      method: 'POST', url: '/api/v1/ai/breakdown-preview',
      payload: {
        parentTaskId: parent.id, parentVersion: parent.version,
        objective: '完成一组可以逐项验收的工作',
        subtasks: [
          { clientId: 'a', title: '步骤 A', definitionOfDone: 'A 已验收', estimatedMinutes: 30 },
          { clientId: 'b', title: '步骤 B', definitionOfDone: 'B 已验收', estimatedMinutes: 30 },
        ],
      },
    })).json();
    await harness.app.inject({
      method: 'PATCH', url: `/api/v1/tasks/${parent.id}`,
      payload: { version: parent.version, patch: { title: 'Changed' } },
    });

    const accepted = await harness.app.inject({
      method: 'POST', url: `/api/v1/cards/${body.card.id}/decision`,
      payload: { decision: 'accept' },
    });
    expect(accepted.statusCode).toBe(400);
    expect((await harness.app.inject({
      method: 'GET', url: `/api/v1/tasks/${parent.id}/subtasks`,
    })).json().items).toHaveLength(0);
  });
});
