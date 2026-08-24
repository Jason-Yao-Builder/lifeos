import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, DEFAULT_TENANT_ID, type LifeOSDatabase } from '../src/index.js';

describe('subtask persistence', () => {
  let database: LifeOSDatabase;

  beforeEach(() => {
    database = createDatabase({
      filename: ':memory:',
      now: () => new Date('2026-08-24T08:00:00.000Z'),
    });
  });

  afterEach(() => {
    database.close();
  });

  it('accepts inherited non-todo status/tags and audits the final child projection', () => {
    const parent = database.store.tasks.create({
      title: 'Parent',
      status: 'in_progress',
      tags: ['parent', 'shared'],
    });
    const child = database.store.tasks.create(
      {
        title: 'Child',
        parentTaskId: parent.id,
        status: parent.status,
        tags: [...parent.tags],
      },
      { type: 'human', id: 'local-user' },
    );

    expect(child).toMatchObject({
      parentTaskId: parent.id,
      status: 'in_progress',
      tags: ['parent', 'shared'],
    });
    expect(database.store.tasks.events(DEFAULT_TENANT_ID, child.id)).toEqual([
      expect.objectContaining({
        type: 'task.created',
        actorType: 'human',
        after: expect.objectContaining({
          parentTaskId: parent.id,
          status: 'in_progress',
          tags: ['parent', 'shared'],
        }),
      }),
    ]);

    const changed = database.store.tasks.update(
      DEFAULT_TENANT_ID,
      child.id,
      child.version,
      { status: 'completed', tags: ['child-only'] },
      { type: 'human' },
    );
    expect(changed).toMatchObject({ status: 'completed', tags: ['child-only'] });
    expect(database.store.tasks.get(DEFAULT_TENANT_ID, parent.id)).toMatchObject({
      status: 'in_progress',
      tags: ['parent', 'shared'],
    });
  });

  it('reorders only one parent direct children while preserving their global rank slots', () => {
    const parent = database.store.tasks.create({ title: 'Parent', rank: 1 });
    const otherParent = database.store.tasks.create({ title: 'Other parent', rank: 10 });
    const first = database.store.tasks.create({ title: 'First', parentTaskId: parent.id, rank: 2 });
    const unrelated = database.store.tasks.create({
      title: 'Unrelated child',
      parentTaskId: otherParent.id,
      rank: 3,
    });
    const second = database.store.tasks.create({ title: 'Second', parentTaskId: parent.id, rank: 4 });
    const third = database.store.tasks.create({ title: 'Third', parentTaskId: parent.id, rank: 5 });

    const reordered = database.store.tasks.reorderSubtasks(
      DEFAULT_TENANT_ID,
      parent.id,
      [third.id, first.id, second.id],
      { type: 'human' },
    );

    expect(reordered.map((task) => task.id)).toEqual([third.id, first.id, second.id]);
    expect(reordered.map((task) => task.rank)).toEqual([2, 4, 5]);
    expect(database.store.tasks.listSubtasks(DEFAULT_TENANT_ID, parent.id).map((task) => task.id))
      .toEqual([third.id, first.id, second.id]);
    expect(database.store.tasks.get(DEFAULT_TENANT_ID, unrelated.id)).toMatchObject({
      rank: 3,
      version: unrelated.version,
      parentTaskId: otherParent.id,
    });
    expect(reordered.every((task) => task.parentTaskId === parent.id)).toBe(true);
    expect(database.store.tasks.events(DEFAULT_TENANT_ID, third.id).at(-1)).toMatchObject({
      type: 'task.reordered',
      metadata: { parentId: parent.id, rank: 2 },
    });

    const versions = reordered.map((task) => task.version);
    const unchanged = database.store.tasks.reorderSubtasks(
      DEFAULT_TENANT_ID,
      parent.id,
      [third.id, first.id, second.id],
    );
    expect(unchanged.map((task) => task.version)).toEqual(versions);

    expect(() => database.store.tasks.reorderSubtasks(
      DEFAULT_TENANT_ID,
      parent.id,
      [third.id, unrelated.id, second.id],
    )).toThrow(/every active direct child/);
    expect(database.store.tasks.listSubtasks(DEFAULT_TENANT_ID, parent.id).map((task) => task.id))
      .toEqual([third.id, first.id, second.id]);
  });
});
