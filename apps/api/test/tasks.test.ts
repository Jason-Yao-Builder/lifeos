import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTask, createTestHarness, type TestHarness } from './harness.js';

describe('task API', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('runs CRUD, scoring, history projection, and soft delete', async () => {
    const created = await createTask(harness.app, {
      title: 'Ship API',
      temperature: 'warm',
      deadline: '2026-08-23',
      tags: ['work'],
    });

    expect(created).toMatchObject({
      title: 'Ship API',
      hardness: 'hard',
      deadline: '2026-08-23T23:59:59+08:00',
      version: 2,
    });
    expect(created.score).toEqual(expect.any(Number));

    const listed = await harness.app.inject({ method: 'GET', url: '/api/v1/tasks' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(1);

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${created.id}`,
      payload: { version: created.version, patch: { title: 'Ship API v2' } },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ title: 'Ship API v2', version: 3 });

    const events = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${created.id}/events`,
    });
    expect(events.statusCode).toBe(200);
    expect(events.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: created.id,
          field: 'title',
          oldValue: 'Ship API',
          newValue: 'Ship API v2',
          summary: 'task.updated: title',
        }),
      ]),
    );

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/tasks/${created.id}?version=${updated.json().version}`,
    });
    expect(removed.statusCode).toBe(204);
    expect(
      (await harness.app.inject({ method: 'GET', url: `/api/v1/tasks/${created.id}` })).statusCode,
    ).toBe(404);
    const retainedEvents = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${created.id}/events`,
    });
    expect(retainedEvents.statusCode).toBe(200);
    expect(retainedEvents.json().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ taskId: created.id })]),
    );
  });

  it('returns the unified 409 envelope for stale versions', async () => {
    const task = await createTask(harness.app, { title: 'Conflict' });
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      payload: { version: task.version - 1, patch: { title: 'Stale write' } },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: 'CONFLICT', correlationId: expect.any(String) },
    });
  });

  it('rolls visible overdue deadlines forward atomically', async () => {
    const first = await createTask(harness.app, { title: 'First overdue', deadline: '2026-08-19' });
    const second = await createTask(harness.app, { title: 'Second overdue', deadline: '2026-08-20' });
    const planned = await createTask(harness.app, {
      title: 'Planned overdue',
      plannedDate: '2026-08-20',
    });
    const rolled = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/tasks/deadlines/roll-forward',
      payload: {
        targetDate: '2026-08-25',
        tasks: [
          { id: first.id, version: first.version },
          { id: second.id, version: second.version },
          { id: planned.id, version: planned.version },
        ],
      },
    });
    expect(rolled.statusCode).toBe(200);
    expect(rolled.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, deadline: '2026-08-25T23:59:59+08:00' }),
      expect.objectContaining({ id: second.id, deadline: '2026-08-25T23:59:59+08:00' }),
      expect.objectContaining({ id: planned.id, deadline: null, plannedDate: '2026-08-25' }),
    ]));

    const third = await createTask(harness.app, { title: 'Rollback first', deadline: '2026-08-18' });
    const fourth = await createTask(harness.app, { title: 'Rollback conflict', deadline: '2026-08-18' });
    await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${fourth.id}`,
      payload: { version: fourth.version, patch: { title: 'Changed elsewhere' } },
    });
    const conflict = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/tasks/deadlines/roll-forward',
      payload: {
        targetDate: '2026-08-25',
        tasks: [
          { id: third.id, version: third.version },
          { id: fourth.id, version: fourth.version },
        ],
      },
    });
    expect(conflict.statusCode).toBe(409);
    const unchanged = await harness.app.inject({ method: 'GET', url: `/api/v1/tasks/${third.id}` });
    expect(unchanged.json()).toMatchObject({
      deadline: '2026-08-18T23:59:59+08:00',
      version: third.version,
    });

    const invalidDate = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/tasks/deadlines/roll-forward',
      payload: { targetDate: '2026-08-20', tasks: [{ id: third.id, version: third.version }] },
    });
    expect(invalidDate.statusCode).toBe(400);
  });

  it('persists manual dimensions and does not replace them with automatic scoring', async () => {
    const scoreDimensions = { impact: 80, urgency: 60, alignment: 90, effort: 40 };
    const created = await createTask(harness.app, { title: 'Manual priority', scoreDimensions });

    expect(created).toMatchObject({ scoreDimensions, score: 75.5, version: 1 });
    const updated = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${created.id}`,
      payload: { version: created.version, patch: { temperature: 'cold' } },
    });
    expect(updated.json()).toMatchObject({ scoreDimensions, score: 75.5, version: 2 });
    const listed = await harness.app.inject({ method: 'GET', url: '/api/v1/tasks' });
    expect(listed.json().items[0]).toMatchObject({ scoreDimensions, score: 75.5, version: 2 });

    const invalid = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: { title: 'Invalid manual priority', scoreDimensions: { ...scoreDimensions, impact: 101 } },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('promotes a later human score edit to protected manual provenance atomically', async () => {
    const created = await createTask(harness.app, { title: 'Edit priority later' });
    const scoreDimensions = { impact: 90, urgency: 60, alignment: 90, effort: 40 };
    const manual = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${created.id}`,
      payload: { version: created.version, patch: { scoreDimensions } },
    });

    expect(manual.statusCode).toBe(200);
    expect(manual.json()).toMatchObject({
      scoreDimensions,
      score: 79.5,
      version: created.version + 1,
    });
    expect(harness.database.store.tasks.get('local-workspace', created.id)).toMatchObject({
      scoreDimensions,
      score: 79.5,
      version: created.version + 1,
    });
    expect(harness.database.store.tasks.events('local-workspace', created.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'task.updated',
          actorType: 'human',
          after: expect.objectContaining({ scoreDimensions, score: 79.5 }),
        }),
      ]),
    );

    const history = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${created.id}/events`,
    });
    expect(history.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'scoreDimensions', newValue: scoreDimensions, actor: 'user' }),
      expect.objectContaining({ field: 'score', newValue: 79.5, actor: 'user' }),
    ]));

    const changedTemperature = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${created.id}`,
      payload: { version: manual.json().version, patch: { temperature: 'cold' } },
    });
    expect(changedTemperature.json()).toMatchObject({
      temperature: 'cold',
      scoreDimensions,
      score: 79.5,
      version: manual.json().version + 1,
    });

    const changedDeadline = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${created.id}`,
      payload: {
        version: changedTemperature.json().version,
        patch: { deadline: '2026-08-30T12:00:00.000Z' },
      },
    });
    expect(changedDeadline.json()).toMatchObject({
      deadline: '2026-08-30T12:00:00.000Z',
      scoreDimensions,
      score: 79.5,
      version: changedTemperature.json().version + 1,
    });

    const explicitAi = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/ai/score-tasks',
      payload: { taskIds: [created.id] },
    });
    expect(explicitAi.statusCode).toBe(200);
    expect(explicitAi.json().results[0]).toMatchObject({
      task: { scoreDimensions, score: 79.5, version: changedDeadline.json().version },
      explanation: '保留人工设定的评分。',
    });
  });

  it('rejects invalid or stale manual score edits', async () => {
    const created = await createTask(harness.app, { title: 'Validate score edit' });
    const scoreDimensions = { impact: 80, urgency: 60, alignment: 90, effort: 40 };
    for (const invalid of [
      null,
      { ...scoreDimensions, impact: 101 },
      { impact: 80, urgency: 60, alignment: 90 },
    ]) {
      const response = await harness.app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${created.id}`,
        payload: { version: created.version, patch: { scoreDimensions: invalid } },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }

    const stale = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${created.id}`,
      payload: { version: created.version - 1, patch: { scoreDimensions } },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'CONFLICT' } });
  });

  it('does not mistake AI scoring or an unrelated human edit for manual provenance', async () => {
    const created = await createTask(harness.app, { title: 'Keep automatic scoring' });
    const renamed = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${created.id}`,
      payload: { version: created.version, patch: { title: 'Still automatic' } },
    });
    const rescored = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${created.id}`,
      payload: { version: renamed.json().version, patch: { temperature: 'cold' } },
    });

    expect(rescored.statusCode).toBe(200);
    expect(rescored.json().version).toBe(renamed.json().version + 2);
    expect(harness.database.store.tasks.events('local-workspace', created.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'task.updated', actorType: 'ai' }),
      ]),
    );
  });

  it('restores completed and archived tasks to todo without losing history', async () => {
    const created = await createTask(harness.app, { title: 'Reopenable task' });
    let current = { version: created.version, status: created.status, completedAt: created.completedAt };
    const move = async (status: string) => {
      const response = await harness.app.inject({
        method: 'PATCH',
        url: `/api/v1/tasks/${created.id}`,
        payload: { version: current.version, patch: { status } },
      });
      expect(response.statusCode).toBe(200);
      current = response.json();
      return current;
    };

    await move('in_progress');
    const completed = await move('completed');
    expect(completed.completedAt).toEqual(expect.any(String));
    const archived = await move('archived');
    expect(archived.completedAt).toBe(completed.completedAt);
    expect((await move('todo')).completedAt).toBeNull();
    await move('in_progress');
    await move('completed');
    expect((await move('todo')).status).toBe('todo');

    const events = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${created.id}/events`,
    });
    expect(
      events.json().items.filter((event: { field: string }) => event.field === 'status').length,
    ).toBeGreaterThanOrEqual(6);
  });

  it('combines list filters and persists manual ordering with history', async () => {
    const alpha = await createTask(harness.app, {
      title: 'Alpha work',
      temperature: 'hot',
      tags: ['work'],
    });
    const beta = await createTask(harness.app, {
      title: 'Beta personal',
      temperature: 'hot',
      tags: ['personal'],
    });
    const gamma = await createTask(harness.app, {
      title: 'Gamma work',
      temperature: 'warm',
      tags: ['work'],
    });

    const filtered = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/tasks?temperature=hot&status=todo&tag=work&query=Alpha&limit=1',
    });
    expect(filtered.json().items.map((task: { id: string }) => task.id)).toEqual([alpha.id]);

    const incompleteReorder = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/tasks/reorder',
      payload: { orderedIds: [beta.id, alpha.id] },
    });
    expect(incompleteReorder.statusCode).toBe(400);

    const reordered = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/tasks/reorder',
      payload: { orderedIds: [gamma.id, beta.id, alpha.id] },
    });
    expect(reordered.statusCode).toBe(200);
    expect(reordered.json().items).toEqual([
      expect.objectContaining({ id: gamma.id, rank: 0, version: gamma.version + 1 }),
      expect.objectContaining({ id: beta.id, rank: 1, version: beta.version + 1 }),
      expect.objectContaining({ id: alpha.id, rank: 2, version: alpha.version + 1 }),
    ]);
    const listed = await harness.app.inject({ method: 'GET', url: '/api/v1/tasks' });
    expect(listed.json().items.map((task: { id: string }) => task.id)).toEqual([
      gamma.id,
      beta.id,
      alpha.id,
    ]);
    const events = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${alpha.id}/events`,
    });
    expect(events.json().items).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'rank', actor: 'user' })]),
    );
  });

  it('returns a newly completed task at the persistent global queue tail', async () => {
    const first = await createTask(harness.app, { title: 'First' });
    const second = await createTask(harness.app, { title: 'Second' });
    const third = await createTask(harness.app, { title: 'Third' });
    const started = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${first.id}`,
      payload: { version: first.version, patch: { status: 'in_progress' } },
    });
    const completed = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${first.id}`,
      payload: { version: started.json().version, patch: { status: 'completed' } },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ rank: 3, version: started.json().version + 1 });

    const expectedOrder = [second.id, third.id, first.id];
    for (let refresh = 0; refresh < 2; refresh += 1) {
      const listed = await harness.app.inject({ method: 'GET', url: '/api/v1/tasks?limit=500' });
      expect(listed.json().items.map((task: { id: string }) => task.id)).toEqual(expectedOrder);
    }
    const stale = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${first.id}`,
      payload: { version: started.json().version, patch: { title: 'Stale completion writer' } },
    });
    expect(stale.statusCode).toBe(409);

    const restored = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${first.id}`,
      payload: { version: completed.json().version, patch: { status: 'todo' } },
    });
    expect(restored.json()).toMatchObject({ status: 'todo', rank: 3 });
    const listed = await harness.app.inject({ method: 'GET', url: '/api/v1/tasks?limit=500' });
    expect(listed.json().items.map((task: { id: string }) => task.id)).toEqual(expectedOrder);
  });

  it('persists cross-parent card rank without changing either parent relationship', async () => {
    const rootA = await createTask(harness.app, { title: 'Root A' });
    const childA = await createTask(harness.app, { title: 'Child A', parentTaskId: rootA.id });
    const rootB = await createTask(harness.app, { title: 'Root B' });
    const childB = await createTask(harness.app, { title: 'Child B', parentTaskId: rootB.id });
    const orderedIds = [rootA.id, childB.id, childA.id, rootB.id];

    const reordered = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/tasks/reorder',
      payload: { orderedIds },
    });
    expect(reordered.statusCode).toBe(200);
    expect(reordered.json().items).toEqual([
      expect.objectContaining({ id: rootA.id, rank: 0, version: rootA.version + 1 }),
      expect.objectContaining({
        id: childB.id,
        parentTaskId: rootB.id,
        rank: 1,
        version: childB.version + 1,
      }),
      expect.objectContaining({
        id: childA.id,
        parentTaskId: rootA.id,
        rank: 2,
        version: childA.version + 1,
      }),
      expect.objectContaining({ id: rootB.id, rank: 3, version: rootB.version + 1 }),
    ]);

    const refreshed = await harness.app.inject({ method: 'GET', url: '/api/v1/tasks?limit=500' });
    expect(refreshed.json().items.map((item: { id: string }) => item.id)).toEqual(orderedIds);
    expect(refreshed.json().items.find((item: { id: string }) => item.id === childA.id).parentTaskId)
      .toBe(rootA.id);
    expect(refreshed.json().items.find((item: { id: string }) => item.id === childB.id).parentTaskId)
      .toBe(rootB.id);
  });

  it('validates temporal invariants at the API boundary', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: {
        title: 'Impossible',
        startAt: '2026-08-23T10:00:00+08:00',
        endAt: '2026-08-23T09:00:00+08:00',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('selects planned, due, and overdue tasks for the requested day', async () => {
    await createTask(harness.app, { title: 'Planned', plannedDate: '2026-08-21' });
    await createTask(harness.app, { title: 'Overdue', deadline: '2026-08-20' });
    await createTask(harness.app, { title: 'Future', plannedDate: '2026-08-22' });

    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/days/2026-08-21' });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.map((task: { title: string }) => task.title)).toEqual([
      'Planned',
      'Overdue',
    ]);
  });
});
