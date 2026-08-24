import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GoalRecordSchema,
  RepeatTemplateRecordSchema,
  ReviewCardRecordSchema,
  TaskDependencyRecordSchema,
  TaskRecordSchema,
} from '@lifeos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  DEFAULT_TENANT_ID,
  DependencyCycleError,
  migrateDatabase,
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
    expect(handle.sqlite.prepare("PRAGMA foreign_key_list('tasks')").all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'group_id', table: 'task_groups', on_delete: 'SET NULL' }),
      ]),
    );
    handle.migrate();
    expect(handle.sqlite.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get())
      .toEqual({ count: 4 });
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

  it('persists newly completed tasks at the workspace queue tail exactly once', () => {
    const handle = setup();
    const { store } = handle;
    const first = store.tasks.create({ title: 'First', rank: 0 });
    const target = store.tasks.create({ title: 'Target', rank: 1 });
    const last = store.tasks.create({ title: 'Last', rank: 2 });
    const deletedHigh = store.tasks.create({ title: 'Deleted high rank', rank: 500 });
    store.tasks.softDelete(
      DEFAULT_TENANT_ID,
      deletedHigh.id,
      deletedHigh.version,
    );
    handle.sqlite.prepare(
      'INSERT INTO workspaces (id, name, timezone, created_at) VALUES (?, ?, ?, ?)',
    ).run('other-workspace', 'Other', 'Asia/Shanghai', fixedNow.toISOString());
    store.tasks.create({
      tenantId: 'other-workspace',
      title: 'Other workspace high rank',
      rank: 900,
    });

    const completedTarget = store.tasks.update(
      DEFAULT_TENANT_ID,
      target.id,
      target.version,
      { status: 'completed' },
    );
    expect(completedTarget).toMatchObject({ rank: 3, version: target.version + 1 });
    expect(store.tasks.list().map((task) => task.id)).toEqual([
      first.id,
      last.id,
      target.id,
    ]);
    expect(store.tasks.events(DEFAULT_TENANT_ID, target.id).at(-1)).toMatchObject({
      type: 'task.updated',
      before: { rank: 1, version: target.version },
      after: { rank: 3, version: target.version + 1 },
    });
    expect(() =>
      store.tasks.update(DEFAULT_TENANT_ID, target.id, target.version, { title: 'stale' }),
    ).toThrow(VersionConflictError);

    const completedFirst = store.tasks.update(
      DEFAULT_TENANT_ID,
      first.id,
      first.version,
      { status: 'completed' },
    );
    expect(completedFirst.rank).toBe(4);
    expect(store.tasks.list().map((task) => task.id)).toEqual([
      last.id,
      target.id,
      first.id,
    ]);

    const repeated = store.tasks.update(
      DEFAULT_TENANT_ID,
      target.id,
      completedTarget.version,
      { status: 'completed' },
    );
    expect(repeated.rank).toBe(completedTarget.rank);
    const renamed = store.tasks.update(
      DEFAULT_TENANT_ID,
      target.id,
      repeated.version,
      { title: 'Target renamed' },
    );
    expect(renamed.rank).toBe(completedTarget.rank);
    const restored = store.tasks.update(
      DEFAULT_TENANT_ID,
      target.id,
      renamed.version,
      { status: 'todo' },
    );
    expect(restored.rank).toBe(completedTarget.rank);
    expect(store.tasks.list().map((task) => task.id)).toEqual([
      last.id,
      target.id,
      first.id,
    ]);
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

  it('persists goal links, subtasks, progress, and range projections', () => {
    const { store } = setup();
    const goal = store.goals.create({ title: 'Ship v0.2' });
    expect(GoalRecordSchema.parse(goal)).toEqual(goal);
    const parent = store.tasks.create({
      title: 'Release',
      goalId: goal.id,
      plannedDate: '2026-08-24',
      startAt: '2026-08-24T09:00:00+08:00',
      endAt: '2026-08-24T11:00:00+08:00',
    });
    const completedChild = store.tasks.create({
      title: 'Done child',
      parentTaskId: parent.id,
      goalId: goal.id,
      status: 'completed',
      plannedDate: '2026-08-24',
    });
    store.tasks.update(
      DEFAULT_TENANT_ID,
      completedChild.id,
      completedChild.version,
      { status: 'archived' },
    );
    store.tasks.create({
      title: 'Open child',
      parentTaskId: parent.id,
      goalId: goal.id,
      deadline: '2026-08-24T22:00:00+08:00',
    });

    expect(store.tasks.listSubtasks(DEFAULT_TENANT_ID, parent.id)).toHaveLength(2);
    expect(store.tasks.progress(DEFAULT_TENANT_ID, parent.id)).toEqual({
      completed: 1,
      total: 2,
      percent: 50,
    });
    expect(store.goals.progress(DEFAULT_TENANT_ID, goal.id)).toMatchObject({
      completed: 1,
      total: 3,
      percent: 33,
    });
    expect(store.tasks.listCalendar({ start: '2026-08-24', end: '2026-08-24' })).toHaveLength(3);
    expect(store.tasks.listGantt({ start: '2026-08-24', end: '2026-08-24' })).toHaveLength(3);
    expect(store.events.forAggregate(DEFAULT_TENANT_ID, 'goal', goal.id).map((event) => event.type))
      .toEqual(['goal.created']);
  });

  it('keeps Gantt rows in rank order when a task timespan changes', () => {
    const { store } = setup();
    const first = store.tasks.create({
      id: 'gantt-a',
      title: 'First row',
      rank: 0,
      startAt: '2026-08-28T09:00:00+08:00',
      endAt: '2026-08-29T18:00:00+08:00',
    });
    store.tasks.create({
      id: 'gantt-b',
      title: 'Second row',
      rank: 1,
      startAt: '2026-08-20T09:00:00+08:00',
      endAt: '2026-08-21T18:00:00+08:00',
    });
    store.tasks.create({
      id: 'gantt-c',
      title: 'Third row',
      rank: 2,
      startAt: '2026-08-24T09:00:00+08:00',
      endAt: '2026-08-25T18:00:00+08:00',
    });

    const ids = () => store.tasks
      .listGantt({ start: '2026-08-01', end: '2026-08-31' })
      .map((task) => task.id);
    expect(ids()).toEqual(['gantt-a', 'gantt-b', 'gantt-c']);

    store.tasks.update(DEFAULT_TENANT_ID, first.id, first.version, {
      startAt: '2026-08-19T09:00:00+08:00',
      endAt: '2026-08-20T18:00:00+08:00',
    });
    expect(ids()).toEqual(['gantt-a', 'gantt-b', 'gantt-c']);
  });

  it('blocks successors, rejects dependency cycles, and computes the duration critical path', () => {
    const { store } = setup();
    const first = store.tasks.create({
      title: 'First',
      estimatedMinutes: 1000,
      startAt: '2026-08-24T09:00:00+08:00',
      endAt: '2026-08-24T09:30:00+08:00',
    });
    const second = store.tasks.create({ title: 'Second', estimatedMinutes: 60 });
    const third = store.tasks.create({ title: 'Third', estimatedMinutes: 30 });
    const longStandalone = store.tasks.create({ title: 'Standalone', estimatedMinutes: 200 });
    const dependency = store.dependencies.create({
      predecessorId: first.id,
      successorId: second.id,
    });
    expect(TaskDependencyRecordSchema.parse(dependency)).toEqual(dependency);
    store.dependencies.create({ predecessorId: second.id, successorId: third.id });

    expect(store.dependencies.isBlocked(DEFAULT_TENANT_ID, second.id)).toBe(true);
    const completedFirst = store.tasks.update(
      DEFAULT_TENANT_ID,
      first.id,
      first.version,
      { status: 'completed' },
    );
    expect(store.dependencies.isBlocked(DEFAULT_TENANT_ID, second.id)).toBe(false);
    store.tasks.update(
      DEFAULT_TENANT_ID,
      first.id,
      completedFirst.version,
      { status: 'archived' },
    );
    expect(store.dependencies.isBlocked(DEFAULT_TENANT_ID, second.id)).toBe(false);
    expect(store.dependencies.criticalPath(DEFAULT_TENANT_ID)).toEqual([longStandalone.id]);
    expect(store.dependencies.criticalPath(DEFAULT_TENANT_ID, [longStandalone.id])).toEqual([
      longStandalone.id,
    ]);
    expect(() =>
      store.dependencies.create({ predecessorId: third.id, successorId: first.id }),
    ).toThrow(DependencyCycleError);
    try {
      store.dependencies.create({ predecessorId: third.id, successorId: first.id });
    } catch (error) {
      expect(error).toMatchObject({ code: 'DEPENDENCY_CYCLE' });
    }
  });

  it('generates repeat instances once within a rolling horizon', () => {
    const { store } = setup();
    const template = store.repeatTemplates.create({
      title: 'Weekday stand-up',
      cronExpr: '0 9 * * 1-5',
      tags: ['routine'],
    });
    expect(RepeatTemplateRecordSchema.parse(template)).toEqual(template);
    const first = store.repeatTemplates.generate(DEFAULT_TENANT_ID, template.id);
    expect(first.dates.slice(0, 5)).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
    ]);
    expect(first.dates).toHaveLength(20);
    expect(first.dates.at(-1)).toBe('2026-09-18');
    expect(first.lastGenerated).toBe('2026-09-19');
    expect(first.tasks).toHaveLength(20);
    expect(first.tasks[0]).toMatchObject({
      repeatTemplateId: template.id,
      plannedStartTime: '09:00',
      tags: ['routine'],
    });
    expect(store.repeatTemplates.generate(DEFAULT_TENANT_ID, template.id).tasks).toHaveLength(0);
    expect(store.events.forAggregate(DEFAULT_TENANT_ID, 'repeat_template', template.id)
      .map((event) => event.type)).toEqual([
      'repeat_template.created',
      'repeat_template.generated',
    ]);
  });

  it('stores typed review periods and updates their content with audit history', () => {
    const { store } = setup();
    const review = store.reviews.create({
      type: 'daily_review',
      periodStart: '2026-08-23',
      periodEnd: '2026-08-23',
      content: {
        plannedTasks: [],
        unplannedCompleted: [],
        completionRate: 50,
        incompleteReasons: [],
        totalFocusMinutes: 0,
      },
    });
    expect(ReviewCardRecordSchema.parse(review)).toEqual(review);
    const updated = store.reviews.update(
      DEFAULT_TENANT_ID,
      review.id,
      {
        plannedTasks: [],
        unplannedCompleted: [],
        completionRate: 80,
        incompleteReasons: [],
        totalFocusMinutes: 0,
      },
    );
    expect(ReviewCardRecordSchema.parse(updated)).toEqual(updated);
    expect(store.reviews.list({
      type: 'daily_review',
      periodFrom: '2026-08-23',
      periodTo: '2026-08-23',
    })).toHaveLength(1);
    expect(store.events.forAggregate(DEFAULT_TENANT_ID, 'review_card', review.id)).toHaveLength(2);
  });

  it('widens deadline candidates for timezone-safe calendar bucketing', () => {
    const { store } = setup();
    const task = store.tasks.create({
      title: 'Midnight boundary',
      deadline: '2026-08-23T17:00:00.000Z',
    });
    expect(store.tasks.listCalendar({ start: '2026-08-24', end: '2026-08-24' })
      .map((item) => item.id)).toContain(task.id);
  });

  it('widens Gantt candidates across an adjacent UTC date', () => {
    const { store } = setup();
    const task = store.tasks.create({
      title: 'Gantt midnight boundary',
      startAt: '2026-08-23T17:00:00.000Z',
      endAt: '2026-08-23T18:00:00.000Z',
    });
    expect(store.tasks.listGantt({ start: '2026-08-24', end: '2026-08-24' })
      .map((item) => item.id)).toContain(task.id);
  });

  it('reapplies migrations safely and recalculates all legacy scores without dropping effort', () => {
    database = createDatabase({
      filename: ':memory:',
      autoMigrate: false,
      autoSeed: false,
      now: () => fixedNow,
    });
    const v01Url = new URL('../drizzle/0000_freezing_machine_man.sql', import.meta.url);
    const v01Sql = readFileSync(v01Url, 'utf8');
    for (const statement of v01Sql.split('--> statement-breakpoint')) {
      if (statement.trim()) database.sqlite.exec(statement);
    }
    database.sqlite.exec(`
      CREATE TABLE "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      )
    `);
    const journal = JSON.parse(
      readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
    ) as { entries: Array<{ when: number }> };
    database.sqlite.prepare(
      'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
    ).run(createHash('sha256').update(v01Sql).digest('hex'), journal.entries[0]!.when);
    database.seed();

    const dimensions = JSON.stringify({ impact: 90, urgency: 60, alignment: 90, effort: 80 });
    const insertTask = database.sqlite.prepare(`
      INSERT INTO tasks (
        id, workspace_id, owner_id, title, score_dimensions_json, score, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertTask.run(
      'auto-score',
      DEFAULT_TENANT_ID,
      'local-user',
      'Automatic score',
      dimensions,
      77,
      fixedNow.toISOString(),
      fixedNow.toISOString(),
    );
    insertTask.run(
      'manual-score',
      DEFAULT_TENANT_ID,
      'local-user',
      'Manual score',
      dimensions,
      42,
      fixedNow.toISOString(),
      fixedNow.toISOString(),
    );
    const insertEvent = database.sqlite.prepare(`
      INSERT INTO events (
        id, workspace_id, aggregate_type, aggregate_id, type, actor_type, after_json, created_at
      ) VALUES (?, ?, 'task', ?, 'task.created', 'human', ?, ?)
    `);
    insertEvent.run(
      'auto-created',
      DEFAULT_TENANT_ID,
      'auto-score',
      JSON.stringify({ scoreDimensions: null }),
      fixedNow.toISOString(),
    );
    insertEvent.run(
      'manual-created',
      DEFAULT_TENANT_ID,
      'manual-score',
      JSON.stringify({ scoreDimensions: JSON.parse(dimensions) }),
      fixedNow.toISOString(),
    );

    const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
    migrateDatabase(database.db, migrationsFolder);
    migrateDatabase(database.db, migrationsFolder);
    expect(database.store.tasks.get(DEFAULT_TENANT_ID, 'auto-score')).toMatchObject({
      score: 79.5,
      scoreDimensions: { effort: 80 },
    });
    expect(database.store.tasks.get(DEFAULT_TENANT_ID, 'manual-score')).toMatchObject({
      score: 79.5,
      scoreDimensions: { effort: 80 },
    });
    expect(database.sqlite.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get())
      .toEqual({ count: 4 });
  });
});
