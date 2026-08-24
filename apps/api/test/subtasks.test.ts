import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tasksForAiContext } from '../src/http.js';
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

  it('copies the parent score at creation and lets the child diverge later', async () => {
    const parentDimensions = { impact: 90, urgency: 70, alignment: 80, effort: 30 };
    const parent = await createTask(harness.app, {
      title: 'Scored parent',
      scoreDimensions: parentDimensions,
    });

    const forged = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${parent.id}/subtasks`,
      payload: {
        title: 'Forged child',
        scoreDimensions: { impact: 1, urgency: 2, alignment: 3, effort: 4 },
      },
    });
    expect(forged.statusCode).toBe(400);

    const created = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${parent.id}/subtasks`,
      payload: { title: 'Inherited child' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const child = created.json();
    expect(child).toMatchObject({
      parentTaskId: parent.id,
      scoreDimensions: parentDimensions,
      score: parent.score,
    });

    const changedParentDimensions = { impact: 20, urgency: 30, alignment: 40, effort: 50 };
    await patchTask(parent.id, parent.version, { scoreDimensions: changedParentDimensions });
    const unchangedChild = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${child.id}`,
    });
    expect(unchangedChild.json()).toMatchObject({
      scoreDimensions: parentDimensions,
      score: parent.score,
    });

    const childDimensions = { impact: 40, urgency: 50, alignment: 60, effort: 70 };
    const changedChild = await patchTask(child.id, child.version, {
      scoreDimensions: childDimensions,
    });
    expect(changedChild).toMatchObject({ scoreDimensions: childDimensions, score: 48.5 });
  });

  it('re-inherits group, tags, and scoring in one versioned update', async () => {
    const parentGroup = harness.database.store.taskGroups.create({
      name: 'Parent group',
      color: '#336699',
    });
    const childGroup = harness.database.store.taskGroups.create({
      name: 'Child group',
      color: '#993366',
    });
    const parentDimensions = { impact: 90, urgency: 70, alignment: 80, effort: 30 };
    const parent = await createTask(harness.app, {
      title: 'Parent',
      groupId: parentGroup.id,
      tags: ['parent'],
      scoreDimensions: parentDimensions,
    });
    const created = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${parent.id}/subtasks`,
      payload: { title: 'Child', description: 'Keep me', temperature: 'cold' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const child = created.json();
    const childDimensions = { impact: 10, urgency: 20, alignment: 30, effort: 40 };
    const diverged = await patchTask(child.id, child.version, {
      groupId: childGroup.id,
      tags: ['child'],
      scoreDimensions: childDimensions,
    });
    const eventCount = harness.database.store.tasks.events('local-workspace', child.id).length;

    const inherited = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${child.id}/inherit-parent`,
      payload: { version: diverged.version },
    });

    expect(inherited.statusCode, inherited.body).toBe(200);
    expect(inherited.json()).toMatchObject({
      title: 'Child',
      description: 'Keep me',
      temperature: 'cold',
      parentTaskId: parent.id,
      groupId: parentGroup.id,
      tags: ['parent'],
      scoreDimensions: parentDimensions,
      score: parent.score,
      version: diverged.version + 1,
    });
    const events = harness.database.store.tasks.events('local-workspace', child.id);
    expect(events).toHaveLength(eventCount + 1);
    expect(events.at(-1)).toMatchObject({
      type: 'task.parent_inherited',
      actorType: 'human',
      after: expect.objectContaining({
        groupId: parentGroup.id,
        tags: ['parent'],
        scoreDimensions: parentDimensions,
      }),
    });

    const eventsBeforeStale = harness.database.store.tasks.events('local-workspace', child.id);
    const stale = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${child.id}/inherit-parent`,
      payload: { version: diverged.version },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'CONFLICT' } });
    expect(harness.database.store.tasks.events('local-workspace', child.id)).toHaveLength(
      eventsBeforeStale.length,
    );
    expect(harness.database.store.tasks.get('local-workspace', child.id)).toMatchObject({
      groupId: parentGroup.id,
      tags: ['parent'],
      scoreDimensions: parentDimensions,
      version: diverged.version + 1,
    });

    const root = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${parent.id}/inherit-parent`,
      payload: { version: parent.version },
    });
    expect(root.statusCode).toBe(400);
    expect(root.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('clears child scoring when re-inheriting from an unscored parent', async () => {
    const parent = harness.database.store.tasks.create({ title: 'Unscored parent' });
    const created = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${parent.id}/subtasks`,
      payload: { title: 'Child' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const child = created.json();
    const childGroup = harness.database.store.taskGroups.create({
      name: 'Child group',
      color: '#993366',
    });
    const diverged = await patchTask(child.id, child.version, {
      groupId: childGroup.id,
      tags: ['child-only'],
      scoreDimensions: { impact: 80, urgency: 70, alignment: 60, effort: 50 },
    });

    const inherited = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${child.id}/inherit-parent`,
      payload: { version: diverged.version },
    });

    expect(inherited.statusCode, inherited.body).toBe(200);
    expect(inherited.json()).toMatchObject({
      groupId: null,
      tags: [],
      scoreDimensions: null,
      score: null,
    });
  });

  it('does not mark inherited AI scoring as manual scoring', async () => {
    const firstDimensions = { impact: 70, urgency: 60, alignment: 80, effort: 30 };
    const parent = harness.database.store.tasks.create(
      {
        title: 'AI-scored parent',
        scoreDimensions: firstDimensions,
        score: 68.5,
      },
      { type: 'ai' },
    );
    const created = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${parent.id}/subtasks`,
      payload: { title: 'Inherited child' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const child = created.json();
    expect(tasksForAiContext(harness.database.store, 'local-workspace', [child])).toEqual([
      expect.objectContaining({ id: child.id, scoreDimensions: null, score: null }),
    ]);

    const secondDimensions = { impact: 90, urgency: 80, alignment: 70, effort: 20 };
    harness.database.store.tasks.update(
      'local-workspace',
      parent.id,
      parent.version,
      { scoreDimensions: secondDimensions, score: 82.5 },
      { type: 'ai' },
    );
    const inherited = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${child.id}/inherit-parent`,
      payload: { version: child.version },
    });
    expect(inherited.statusCode, inherited.body).toBe(200);
    const inheritedChild = inherited.json();
    expect(inheritedChild).toMatchObject({ scoreDimensions: secondDimensions, score: 82.5 });
    expect(tasksForAiContext(
      harness.database.store,
      'local-workspace',
      [inheritedChild],
    )).toEqual([
      expect.objectContaining({ id: child.id, scoreDimensions: null, score: null }),
    ]);
  });

  it('rejects inheritance when the direct parent no longer exists', async () => {
    const parent = harness.database.store.tasks.create({ title: 'Parent' });
    const child = harness.database.store.tasks.create({
      title: 'Child',
      parentTaskId: parent.id,
    });
    harness.database.store.tasks.softDelete(
      'local-workspace',
      parent.id,
      parent.version,
      { type: 'human' },
    );

    const response = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${child.id}/inherit-parent`,
      payload: { version: child.version },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
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
