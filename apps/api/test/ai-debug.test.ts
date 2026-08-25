import { createDeterministicAI } from '@lifeos/ai';
import { defaultDatabaseFilename } from '@lifeos/db';
import { createDatabase } from '@lifeos/db';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createTask, createTestHarness, type TestHarness } from './harness.js';

describe('AI idempotency and debug API', () => {
  let harness: TestHarness | undefined;

  afterEach(async () => {
    await harness?.close();
  });

  it('returns the same daily summary card for the same date', async () => {
    harness = await createTestHarness();
    await createTask(harness.app, {
      title: 'Today focus',
      temperature: 'hot',
      plannedDate: '2026-08-21',
    });

    const first = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/ai/daily-summary',
      payload: { date: '2026-08-21' },
    });
    const second = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/ai/daily-summary',
      payload: { date: '2026-08-21' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ reused: true });
    expect(second.json().card.id).toBe(first.json().card.id);
    const cards = await harness.app.inject({ method: 'GET', url: '/api/v1/cards?type=generation' });
    expect(cards.json().items).toHaveLength(1);
  });

  it('allows only one concurrent daily-summary owner to create a card', async () => {
    harness = await createTestHarness();
    await createTask(harness.app, { title: 'Concurrent focus', temperature: 'hot' });
    const request = () =>
      harness!.app.inject({
        method: 'POST',
        url: '/api/v1/ai/daily-summary',
        payload: { date: '2026-08-21' },
      });

    const responses = await Promise.all([request(), request()]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual(
      expect.arrayContaining([200]),
    );
    expect(responses.every((response) => [200, 409].includes(response.statusCode))).toBe(true);
    const cards = await harness.app.inject({ method: 'GET', url: '/api/v1/cards?type=generation' });
    expect(cards.json().items).toHaveLength(1);
  });

  it('uses globally unique claims across Fastify instances', async () => {
    const now = new Date('2026-08-21T09:00:00+08:00');
    const database = createDatabase({ filename: ':memory:', now: () => now });
    const base = createDeterministicAI({ now: () => now });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ai = {
      ...base,
      dailySummary: async (...args: Parameters<typeof base.dailySummary>) => {
        await gate;
        return base.dailySummary(...args);
      },
    };
    const apps = await Promise.all([
      buildApp({ dependencies: { store: database.store, ai, now: () => now } }),
      buildApp({ dependencies: { store: database.store, ai, now: () => now } }),
    ]);
    await Promise.all(apps.map((app) => app.ready()));

    try {
      const requests = apps.map((app) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/ai/daily-summary',
          payload: { date: '2026-08-21' },
        }),
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      release();
      const responses = await Promise.all(requests);

      expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
      expect(database.store.cards.list({ type: 'generation' })).toHaveLength(1);
    } finally {
      await Promise.all(apps.map((app) => app.close()));
      database.close();
    }
  });

  it('guards debug endpoints and wraps recent events', async () => {
    harness = await createTestHarness({ debugApiKey: 'test-secret' });
    await createTask(harness.app, { title: 'Observable task' });

    const denied = await harness.app.inject({ method: 'GET', url: '/api/v1/debug/health' });
    expect(denied.statusCode).toBe(401);
    expect(denied.json().error.code).toBe('UNAUTHORIZED');

    const headers = { 'x-api-key': 'test-secret' };
    const health = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/debug/health',
      headers,
    });
    expect(health.json()).toMatchObject({ status: 'ok', database: 'ok' });

    const stats = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/debug/stats',
      headers,
    });
    expect(stats.json().tasks.total).toBe(1);

    const events = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/debug/events?limit=5',
      headers,
    });
    expect(events.json().items.length).toBeGreaterThan(0);
  });

  it('publishes an OpenAPI document and CORS headers', async () => {
    harness = await createTestHarness({ corsOrigin: 'https://lifeos.local' });
    const docs = await harness.app.inject({ method: 'GET', url: '/docs/json' });
    expect(docs.statusCode).toBe(200);
    expect(docs.json().paths).toHaveProperty('/api/v1/tasks');

    const cors = await harness.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/tasks',
      headers: {
        origin: 'https://lifeos.local',
        'access-control-request-method': 'GET',
      },
    });
    expect(cors.headers['access-control-allow-origin']).toBe('https://lifeos.local');

    const patchCors = await harness.app.inject({
      method: 'OPTIONS',
      url: '/api/v1/tasks/task-id',
      headers: {
        origin: 'https://lifeos.local',
        'access-control-request-method': 'PATCH',
      },
    });
    expect(patchCors.headers['access-control-allow-methods']).toContain('PATCH');
  });

  it('does not register debug routes when disabled', async () => {
    const now = new Date('2026-08-21T09:00:00+08:00');
    const database = createDatabase({ filename: ':memory:', now: () => now });
    const app = await buildApp({
      dependencies: {
        store: database.store,
        ai: createDeterministicAI({ now: () => now }),
        now: () => now,
      },
      debugApiEnabled: false,
    });
    await app.ready();

    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/debug/health' });
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
      database.close();
    }
  });

  it('rejects invalid AI scores before they can pollute task storage', async () => {
    const base = createDeterministicAI();
    harness = await createTestHarness({
      ai: {
        ...base,
        scoreTasks: (tasks) =>
          tasks.map((task) => ({
            taskId: task.id,
            dimensions: { impact: 999, urgency: 50, alignment: 50, effort: 50 },
            score: 999,
            explanation: 'invalid provider output',
          })),
      },
    });

    const created = await createTask(harness.app, { title: 'Safe fallback' });
    expect(created.score).toBeNull();

    const scoring = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/ai/score-tasks',
      payload: { taskIds: [created.id] },
    });
    expect(scoring.statusCode).toBe(503);

    const listed = await harness.app.inject({ method: 'GET', url: '/api/v1/tasks' });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items[0].score).toBeNull();
  });

  it('keeps manually assigned dimensions when explicit AI scoring runs', async () => {
    const base = createDeterministicAI();
    let scoringCalls = 0;
    harness = await createTestHarness({
      ai: {
        ...base,
        scoreTasks: (tasks) => {
          scoringCalls += 1;
          return base.scoreTasks(tasks);
        },
      },
    });
    const dimensions = { impact: 80, urgency: 60, alignment: 90, effort: 40 };
    const created = await createTask(harness.app, {
      title: 'Human priority',
      scoreDimensions: dimensions,
    });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/ai/score-tasks',
      payload: { taskIds: [created.id] },
    });

    expect(response.statusCode).toBe(200);
    expect(scoringCalls).toBe(0);
    expect(response.json().results[0]).toMatchObject({
      task: { scoreDimensions: dimensions, score: 75.5, version: 1 },
    });
  });

  it('keeps only manual scores in summary and coaching context', async () => {
    const base = createDeterministicAI();
    let summaryTasks: Parameters<typeof base.dailySummary>[0] = [];
    let replyTasks: Parameters<typeof base.reply>[0]['tasks'] = [];
    harness = await createTestHarness({
      ai: {
        ...base,
        dailySummary: (tasks, date) => {
          summaryTasks = tasks;
          return base.dailySummary(tasks, date);
        },
        reply: (input) => {
          replyTasks = input.tasks;
          return base.reply(input);
        },
      },
    });
    const automatic = await createTask(harness.app, {
      title: 'Automatic priority',
      plannedDate: '2026-08-21',
    });
    const manual = await createTask(harness.app, {
      title: 'Manual priority',
      plannedDate: '2026-08-21',
      scoreDimensions: { impact: 80, urgency: 60, alignment: 90, effort: 40 },
    });
    expect(automatic.score).not.toBeNull();

    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/ai/daily-summary',
      payload: { date: '2026-08-21' },
    });
    const conversation = harness.database.store.conversations.create({ title: 'Coach' });
    await harness.app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conversation.id}/messages`,
      payload: { content: '下一步做什么？' },
    });

    for (const context of [summaryTasks, replyTasks ?? []]) {
      expect(context.find((task) => task.id === automatic.id)).toMatchObject({
        scoreDimensions: null,
        score: null,
      });
      expect(context.find((task) => task.id === manual.id)).toMatchObject({
        scoreDimensions: manual.scoreDimensions,
        score: 75.5,
      });
    }
  });

  it('rejects missing or unknown score task ids without partial writes', async () => {
    const base = createDeterministicAI();
    harness = await createTestHarness({
      ai: {
        ...base,
        scoreTasks: () => [{
          ...base.scoreTask(harness!.database.store.tasks.list()[0]!),
          taskId: 'unknown-task',
        }],
      },
    });
    const first = harness.database.store.tasks.create({ title: 'First unscored' });
    harness.database.store.tasks.create({ title: 'Second unscored' });

    const response = await harness.app.inject({ method: 'POST', url: '/api/v1/ai/score-tasks' });
    expect(response.statusCode).toBe(503);
    expect(harness.database.store.tasks.get(first.tenantId, first.id)?.score).toBeNull();
    expect(harness.database.store.tasks.list().every((task) => task.score === null)).toBe(true);
  });

  it('rolls back every score when one task changes during a batch', async () => {
    const now = new Date('2026-08-21T09:00:00+08:00');
    const database = createDatabase({ filename: ':memory:', now: () => now });
    const first = database.store.tasks.create({ title: 'First' });
    const second = database.store.tasks.create({ title: 'Second' });
    const base = createDeterministicAI({ now: () => now });
    let changed = false;
    const app = await buildApp({
      dependencies: {
        store: database.store,
        now: () => now,
        ai: {
          ...base,
          scoreTasks: (tasks) => {
            if (!changed) {
              const current = database.store.tasks.get(second.tenantId, second.id)!;
              database.store.tasks.update(
                second.tenantId,
                second.id,
                current.version,
                { title: 'Changed concurrently' },
              );
              changed = true;
            }
            return base.scoreTasks(tasks);
          },
        },
      },
    });
    await app.ready();

    try {
      const response = await app.inject({ method: 'POST', url: '/api/v1/ai/score-tasks' });
      expect(response.statusCode).toBe(503);
      expect(database.store.tasks.get(first.tenantId, first.id)?.score).toBeNull();
      expect(database.store.tasks.get(second.tenantId, second.id)?.score).toBeNull();
    } finally {
      await app.close();
      database.close();
    }
  });

  it('resolves relative database paths from the workspace root', () => {
    expect(readConfig({ DATABASE_URL: './custom.db' }).databaseUrl).toMatch(
      /workspace\/custom\.db$/,
    );
  });

  it('keeps the default database outside the source workspace', () => {
    expect(readConfig({}).databaseUrl).toBe(defaultDatabaseFilename({ env: {} }));
    expect(readConfig({}).databaseUrl).not.toMatch(/workspace\/data\/lifeos\.db$/);
  });

  it('retries a failed daily summary and then reuses the recovered card', async () => {
    const base = createDeterministicAI();
    let calls = 0;
    harness = await createTestHarness({
      ai: {
        ...base,
        dailySummary: (tasks, date) => {
          calls += 1;
          if (calls === 1) throw new Error('transient provider failure');
          return base.dailySummary(tasks, date);
        },
      },
    });

    const first = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/ai/daily-summary',
      payload: { date: '2026-08-21' },
    });
    const second = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/ai/daily-summary',
      payload: { date: '2026-08-21' },
    });
    const third = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/ai/daily-summary',
      payload: { date: '2026-08-21' },
    });

    expect(first.statusCode).toBe(503);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(200);
    expect(third.json()).toMatchObject({ reused: true });
    expect(third.json().card.id).toBe(second.json().card.id);
    expect(calls).toBe(2);
  });
});
