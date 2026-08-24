import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConflictError,
  createDatabase,
  DEFAULT_TENANT_ID,
  migrateDatabase,
  type LifeOSDatabase,
} from '../src/index.js';

describe('task group persistence', () => {
  let database: LifeOSDatabase;

  beforeEach(() => {
    database = createDatabase({
      filename: ':memory:',
      now: () => new Date('2026-08-24T08:00:00.000Z'),
    });
  });

  afterEach(() => database.close());

  it('normalizes names and colors, enforces workspace-local uniqueness, and audits changes', () => {
    const work = database.store.taskGroups.create(
      { name: '  Work  ', color: '#a1b2c3' },
      { type: 'human', id: 'local-user' },
    );
    expect(work).toMatchObject({
      workspaceId: DEFAULT_TENANT_ID,
      name: 'Work',
      color: '#A1B2C3',
    });
    expect(() => database.store.taskGroups.create({ name: ' work ', color: '#123456' }))
      .toThrow(ConflictError);

    const personal = database.store.taskGroups.create({ name: 'Personal', color: '#334455' });
    expect(() => database.store.taskGroups.update(
      DEFAULT_TENANT_ID,
      personal.id,
      { name: 'WORK' },
    )).toThrow(ConflictError);
    const renamed = database.store.taskGroups.update(
      DEFAULT_TENANT_ID,
      work.id,
      { name: ' Work Stream ', color: '#abcdef' },
      { type: 'human' },
    );
    expect(renamed).toMatchObject({ name: 'Work Stream', color: '#ABCDEF' });
    expect(database.store.taskGroups.list()).toEqual([personal, renamed]);
    expect(database.store.events.forAggregate(DEFAULT_TENANT_ID, 'task_group', work.id))
      .toEqual([
        expect.objectContaining({ type: 'task_group.created', after: work }),
        expect.objectContaining({ type: 'task_group.updated', before: work, after: renamed }),
      ]);
  });

  it('binds task groups to a workspace and supports move, clear, audit, and FK set-null', () => {
    const localGroup = database.store.taskGroups.create({ name: 'Local', color: '#112233' });
    database.sqlite.prepare(
      'INSERT INTO workspaces (id, name, timezone, created_at) VALUES (?, ?, ?, ?)',
    ).run('other-workspace', 'Other', 'Asia/Shanghai', '2026-08-24T08:00:00.000Z');
    const otherGroup = database.store.taskGroups.create({
      workspaceId: 'other-workspace',
      name: ' local ',
      color: '#445566',
    });
    expect(otherGroup.name).toBe('local');
    expect(() => database.store.tasks.create({
      title: 'Cross workspace create',
      groupId: otherGroup.id,
    })).toThrow(/task_group not found/);

    const task = database.store.tasks.create({ title: 'Grouped task', groupId: localGroup.id });
    expect(task.groupId).toBe(localGroup.id);
    const moved = database.store.tasks.update(
      DEFAULT_TENANT_ID,
      task.id,
      task.version,
      { groupId: null },
      { type: 'human' },
    );
    expect(moved.groupId).toBeNull();
    expect(database.store.tasks.events(DEFAULT_TENANT_ID, task.id).at(-1)).toMatchObject({
      type: 'task.updated',
      before: expect.objectContaining({ groupId: localGroup.id }),
      after: expect.objectContaining({ groupId: null }),
    });

    const attached = database.store.tasks.create({ title: 'FK task', groupId: localGroup.id });
    database.sqlite.prepare('DELETE FROM task_groups WHERE id = ?').run(localGroup.id);
    expect(database.store.tasks.get(DEFAULT_TENANT_ID, attached.id)?.groupId).toBeNull();
  });

  it('upgrades existing 0002 tasks to 0003 without data loss and is migration-idempotent', () => {
    database.close();
    database = createDatabase({
      filename: ':memory:',
      autoMigrate: false,
      autoSeed: false,
      now: () => new Date('2026-08-24T08:00:00.000Z'),
    });
    const migrationTags = [
      '0000_freezing_machine_man',
      '0001_nice_sabretooth',
      '0002_cynical_gauntlet',
    ];
    const journal = JSON.parse(
      readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: Array<{ tag: string; when: number }> };
    database.sqlite.exec(`
      CREATE TABLE "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      )
    `);
    for (const tag of migrationTags) {
      const sql = readFileSync(new URL(`../drizzle/${tag}.sql`, import.meta.url), 'utf8');
      for (const statement of sql.split('--> statement-breakpoint')) {
        if (statement.trim()) database.sqlite.exec(statement);
      }
      const entry = journal.entries.find((candidate) => candidate.tag === tag);
      expect(entry).toBeDefined();
      database.sqlite.prepare(
        'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
      ).run(createHash('sha256').update(sql).digest('hex'), entry!.when);
    }

    const createdAt = '2026-08-23T08:00:00.000Z';
    database.sqlite.prepare(
      'INSERT INTO workspaces (id, name, timezone, created_at) VALUES (?, ?, ?, ?)',
    ).run(DEFAULT_TENANT_ID, 'Legacy workspace', 'Asia/Shanghai', createdAt);
    database.sqlite.prepare(
      'INSERT INTO users (id, workspace_id, display_name, created_at) VALUES (?, ?, ?, ?)',
    ).run('legacy-user', DEFAULT_TENANT_ID, 'Legacy user', createdAt);
    database.sqlite.prepare(`
      INSERT INTO tasks (
        id, workspace_id, owner_id, title, description, temperature, status,
        tags_json, rank, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'legacy-task',
      DEFAULT_TENANT_ID,
      'legacy-user',
      'Keep this task',
      'Created before task groups',
      'warm',
      'in_progress',
      '["legacy"]',
      17,
      4,
      createdAt,
      createdAt,
    );
    expect(database.sqlite.prepare("PRAGMA table_info('tasks')").all()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'group_id' })]),
    );

    const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
    migrateDatabase(database.db, migrationsFolder);
    migrateDatabase(database.db, migrationsFolder);

    expect(database.store.tasks.get(DEFAULT_TENANT_ID, 'legacy-task')).toMatchObject({
      id: 'legacy-task',
      title: 'Keep this task',
      description: 'Created before task groups',
      status: 'in_progress',
      tags: ['legacy'],
      rank: 17,
      version: 4,
      groupId: null,
    });
    expect(database.sqlite.prepare("PRAGMA foreign_key_list('tasks')").all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'group_id',
          table: 'task_groups',
          on_delete: 'SET NULL',
        }),
      ]),
    );
    expect(database.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(database.sqlite.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get())
      .toEqual({ count: 4 });
  });
});
