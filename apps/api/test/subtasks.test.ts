import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTask, createTestHarness, type TestHarness } from './harness.js';

describe('subtask inheritance API', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('forces current parent tags/status, then lets each child diverge through PATCH', async () => {
    const createdParent = await createTask(harness.app, {
      title: 'Parent',
      tags: ['parent', 'shared'],
      temperature: 'hot',
    });
    const startedParent = await patchTask(createdParent.id, createdParent.version, {
      status: 'in_progress',
    });

    const created = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${createdParent.id}/subtasks`,
      payload: {
        title: 'First child',
        description: 'Keep this input',
        temperature: 'cold',
        plannedDate: '2026-08-25',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const firstChild = created.json();
    expect(firstChild).toMatchObject({
      title: 'First child',
      description: 'Keep this input',
      temperature: 'cold',
      plannedDate: '2026-08-25',
      tags: ['parent', 'shared'],
      status: 'in_progress',
      parentTaskId: createdParent.id,
    });
    const refreshedChild = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${firstChild.id}`,
    });
    expect(refreshedChild.statusCode).toBe(200);
    expect(refreshedChild.json()).toMatchObject({
      tags: ['parent', 'shared'],
      status: 'in_progress',
      parentTaskId: createdParent.id,
    });
    expect(harness.database.store.tasks.events('local-workspace', firstChild.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'task.created',
          actorType: 'human',
          after: expect.objectContaining({
            tags: ['parent', 'shared'],
            status: 'in_progress',
            parentTaskId: createdParent.id,
          }),
        }),
      ]),
    );

    for (const protectedField of [
      { status: 'todo' },
      { tags: ['client-forged'] },
      { parentTaskId: 'client-parent' },
    ]) {
      const rejected = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${createdParent.id}/subtasks`,
        payload: { title: 'Forged child', ...protectedField },
      });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }
    const listedAfterForgery = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${createdParent.id}/subtasks`,
    });
    expect(listedAfterForgery.json().items).toHaveLength(1);

    const completedParent = await patchTask(startedParent.id, startedParent.version, {
      tags: ['parent-latest'],
      status: 'completed',
    });
    const persistedChild = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${firstChild.id}`,
    });
    expect(persistedChild.statusCode).toBe(200);
    expect(persistedChild.json()).toMatchObject({
      tags: ['parent', 'shared'],
      status: 'in_progress',
    });

    const changedChild = await patchTask(firstChild.id, firstChild.version, {
      tags: ['child-only'],
      status: 'completed',
    });
    expect(changedChild).toMatchObject({
      tags: ['child-only'],
      status: 'completed',
      parentTaskId: createdParent.id,
    });
    const refreshedChangedChild = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${firstChild.id}`,
    });
    expect(refreshedChangedChild.json()).toMatchObject({
      tags: ['child-only'],
      status: 'completed',
      parentTaskId: createdParent.id,
    });
    expect(harness.database.store.tasks.get('local-workspace', completedParent.id)).toMatchObject({
      tags: ['parent-latest'],
      status: 'completed',
    });
    expect(harness.database.store.tasks.events('local-workspace', firstChild.id).at(-1)).toMatchObject({
      type: 'task.updated',
      after: expect.objectContaining({ tags: ['child-only'], status: 'completed' }),
    });
  });

  it('reorders the complete direct-child set without changing parent ownership', async () => {
    const parent = await createTask(harness.app, { title: 'Parent' });
    const otherParent = await createTask(harness.app, { title: 'Other parent' });
    const children: Array<{ id: string; parentTaskId: string; version: number }> = [];
    for (const title of ['First', 'Second', 'Third']) {
      const response = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${parent.id}/subtasks`,
        payload: { title },
      });
      expect(response.statusCode, response.body).toBe(201);
      children.push(response.json());
    }
    const unrelatedResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${otherParent.id}/subtasks`,
      payload: { title: 'Unrelated' },
    });
    expect(unrelatedResponse.statusCode, unrelatedResponse.body).toBe(201);
    const unrelated = unrelatedResponse.json();

    const orderedIds = [children[2]!.id, children[0]!.id, children[1]!.id];
    const reordered = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${parent.id}/subtasks/reorder`,
      payload: { orderedIds },
    });
    expect(reordered.statusCode, reordered.body).toBe(200);
    expect(reordered.json().items.map((task: { id: string }) => task.id)).toEqual(orderedIds);
    expect(reordered.json().items.every((task: { parentTaskId: string }) => task.parentTaskId === parent.id))
      .toBe(true);

    const refreshed = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${parent.id}/subtasks`,
    });
    expect(refreshed.json().items.map((task: { id: string }) => task.id)).toEqual(orderedIds);
    const unrelatedAfter = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${otherParent.id}/subtasks`,
    });
    expect(unrelatedAfter.json().items).toEqual([
      expect.objectContaining({ id: unrelated.id, parentTaskId: otherParent.id }),
    ]);

    const rejected = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${parent.id}/subtasks/reorder`,
      payload: { orderedIds: [children[2]!.id, unrelated.id, children[1]!.id] },
    });
    expect(rejected.statusCode).toBe(400);
    const afterRejected = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${parent.id}/subtasks`,
    });
    expect(afterRejected.json().items.map((task: { id: string }) => task.id)).toEqual(orderedIds);
  });

  async function patchTask(id: string, version: number, patch: Record<string, unknown>) {
    const response = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${id}`,
      payload: { version, patch },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }
});
