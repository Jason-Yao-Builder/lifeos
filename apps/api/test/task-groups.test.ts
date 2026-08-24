import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTask, createTestHarness, type TestHarness } from './harness.js';

describe('task group API', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => harness.close());

  async function createGroup(name: string, color: string) {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/task-groups',
      payload: { name, color },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json();
  }

  it('creates, lists, patches, validates, scopes, and audits groups', async () => {
    const work = await createGroup('  Work  ', '#a1b2c3');
    expect(work).toMatchObject({
      workspaceId: 'local-workspace',
      name: 'Work',
      color: '#A1B2C3',
    });
    const listed = await harness.app.inject({ method: 'GET', url: '/api/v1/task-groups' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toEqual([work]);

    const duplicate = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/task-groups',
      payload: { name: ' work ', color: '#123456' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Task group name already exists in this workspace',
        correlationId: expect.any(String),
      },
    });

    for (const payload of [
      { name: 'Broken', color: '#12345' },
      { name: 'Extra', color: '#123456', extra: true },
    ]) {
      const response = await harness.app.inject({
        method: 'POST',
        url: '/api/v1/task-groups',
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }

    const personal = await createGroup('Personal', '#445566');
    const duplicateRename = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/task-groups/${personal.id}`,
      payload: { name: ' WORK ' },
    });
    expect(duplicateRename.statusCode).toBe(409);
    expect(duplicateRename.json()).toMatchObject({
      error: {
        code: 'CONFLICT',
        message: 'Task group name already exists in this workspace',
        correlationId: expect.any(String),
      },
    });

    const patched = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/task-groups/${work.id}`,
      payload: { name: ' Work Stream ', color: '#abcdef' },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json()).toMatchObject({ name: 'Work Stream', color: '#ABCDEF' });
    expect(harness.database.store.events.forAggregate('local-workspace', 'task_group', work.id))
      .toEqual([
        expect.objectContaining({ type: 'task_group.created' }),
        expect.objectContaining({ type: 'task_group.updated' }),
      ]);

    harness.database.sqlite.prepare(
      'INSERT INTO workspaces (id, name, timezone, created_at) VALUES (?, ?, ?, ?)',
    ).run('other-workspace', 'Other', 'Asia/Shanghai', harness.now.toISOString());
    const other = harness.database.store.taskGroups.create({
      workspaceId: 'other-workspace',
      name: 'Other',
      color: '#445566',
    });
    const hidden = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/task-groups/${other.id}`,
      payload: { color: '#778899' },
    });
    expect(hidden.statusCode).toBe(404);
  });

  it('persists task assignment, movement, clearing, and rejects cross-workspace groups', async () => {
    const first = await createGroup('First', '#112233');
    const second = await createGroup('Second', '#445566');
    const task = await createTask(harness.app, { title: 'Grouped task', groupId: first.id });
    expect(task.groupId).toBe(first.id);
    expect((await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}`,
    })).json().groupId).toBe(first.id);

    const moved = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      payload: { version: task.version, patch: { groupId: second.id } },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json().groupId).toBe(second.id);
    const cleared = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      payload: { version: moved.json().version, patch: { groupId: null } },
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().groupId).toBeNull();
    const history = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}/events`,
    });
    expect(history.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'groupId', oldValue: first.id, newValue: second.id }),
      expect.objectContaining({ field: 'groupId', oldValue: second.id, newValue: null }),
    ]));

    harness.database.sqlite.prepare(
      'INSERT INTO workspaces (id, name, timezone, created_at) VALUES (?, ?, ?, ?)',
    ).run('other-workspace', 'Other', 'Asia/Shanghai', harness.now.toISOString());
    const other = harness.database.store.taskGroups.create({
      workspaceId: 'other-workspace',
      name: 'Other',
      color: '#778899',
    });
    const rejected = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      payload: { title: 'Cross workspace', groupId: other.id },
    });
    expect(rejected.statusCode).toBe(404);
    const rejectedMove = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      payload: { version: cleared.json().version, patch: { groupId: other.id } },
    });
    expect(rejectedMove.statusCode).toBe(404);
    const refreshed = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}`,
    });
    expect(refreshed.json()).toMatchObject({
      groupId: null,
      version: cleared.json().version,
    });
  });

  it('ignores a client groupId and snapshots the parent group, including null', async () => {
    const inherited = await createGroup('Inherited', '#123456');
    const forged = await createGroup('Forged', '#654321');
    const parent = await createTask(harness.app, { title: 'Parent', groupId: inherited.id });
    const child = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${parent.id}/subtasks`,
      payload: { title: 'Child', groupId: forged.id },
    });
    expect(child.statusCode, child.body).toBe(201);
    expect(child.json()).toMatchObject({ parentTaskId: parent.id, groupId: inherited.id });

    const ungroupedParent = await createTask(harness.app, { title: 'Ungrouped parent' });
    const ungroupedChild = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${ungroupedParent.id}/subtasks`,
      payload: { title: 'Ungrouped child', groupId: forged.id },
    });
    expect(ungroupedChild.statusCode, ungroupedChild.body).toBe(201);
    expect(ungroupedChild.json().groupId).toBeNull();
    const refreshed = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${parent.id}/subtasks`,
    });
    expect(refreshed.json().items).toEqual([
      expect.objectContaining({ id: child.json().id, groupId: inherited.id }),
    ]);
  });
});
