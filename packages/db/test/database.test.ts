import { TaskRecordSchema } from '@lifeos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  DEFAULT_TENANT_ID,
  VersionConflictError,
  type LifeOSDatabase,
} from '../src/index.js';

const fixedNow = new Date('2026-08-23T08:00:00.000Z');
let database: LifeOSDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

function setup(): LifeOSDatabase {
  database = createDatabase({ filename: ':memory:', now: () => fixedNow });
  return database;
}

describe('createDatabase', () => {
  it('migrates, seeds defaults, and enables safety pragmas', () => {
    const handle = setup();
    expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(handle.sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(handle.store.rules.list()).toHaveLength(3);
  });

  it('creates contract-compatible tasks and appends audit events atomically', () => {
    const { store } = setup();
    const created = store.tasks.create({
      title: 'Write proposal',
      temperature: 'hot',
      plannedDate: '2026-08-23',
      tags: ['work'],
    }, { type: 'human', id: 'local-user' });

    expect(TaskRecordSchema.parse(created)).toEqual(created);
    expect(created.actualMinutes).toBe(0);
    expect(store.tasks.events(DEFAULT_TENANT_ID, created.id)).toHaveLength(1);

    const updated = store.tasks.update(
      DEFAULT_TENANT_ID,
      created.id,
      created.version,
      { status: 'completed' },
      { type: 'human' },
    );
    expect(updated.completedAt).toBe(fixedNow.toISOString());
    expect(store.tasks.events(DEFAULT_TENANT_ID, created.id)).toHaveLength(2);
    expect(() =>
      store.tasks.update(DEFAULT_TENANT_ID, created.id, created.version, { title: 'stale' }),
    ).toThrow(VersionConflictError);
  });

  it('rolls back state and event when a transaction callback fails', () => {
    const handle = setup();
    expect(() =>
      handle.transaction((store) => {
        store.tasks.create({ title: 'Must roll back' });
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(handle.store.tasks.list()).toHaveLength(0);
    expect(handle.store.debug.recentEvents()).toHaveLength(0);
  });

  it('soft-deletes a task and records the final projection', () => {
    const { store } = setup();
    const task = store.tasks.create({ title: 'Archive me' });
    const deleted = store.tasks.softDelete(DEFAULT_TENANT_ID, task.id, task.version);
    expect(deleted.deletedAt).toBe(fixedNow.toISOString());
    expect(deleted.status).toBe('archived');
    expect(store.tasks.list()).toHaveLength(0);
    expect(store.tasks.events(DEFAULT_TENANT_ID, task.id).at(-1)?.type).toBe('task.deleted');
  });

  it('applies tag filtering before pagination', () => {
    const { store } = setup();
    store.tasks.create({ title: 'First', tags: ['personal'] });
    store.tasks.create({ title: 'Second', tags: ['personal'] });
    store.tasks.create({ title: 'Tagged', tags: ['work'] });
    expect(store.tasks.list({ tag: 'work', limit: 1 }).map((task) => task.title)).toEqual([
      'Tagged',
    ]);
  });

  it('persists cards and marks discussions', () => {
    const { store } = setup();
    const card = store.cards.create({
      type: 'observation',
      title: 'Stalled',
      body: 'No update for seven days.',
    });
    store.conversations.create({ cardId: card.id, title: 'Discuss card' });
    expect(store.cards.get(DEFAULT_TENANT_ID, card.id)?.hasDiscussion).toBe(true);
    expect(store.cards.get(DEFAULT_TENANT_ID, card.id)?.status).toBe('discussing');
  });
});
