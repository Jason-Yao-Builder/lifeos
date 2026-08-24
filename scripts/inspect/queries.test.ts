import { describe, expect, it } from 'vitest';
import { createDatabase, DEFAULT_TENANT_ID } from '../../packages/db/src/index.js';
import { inspectState, inspectTaskTimeline } from './queries.js';

describe('maintenance inspection queries', () => {
  it('prints complete state counts including soft-deleted tasks', () => {
    const database = createDatabase({ filename: ':memory:' });
    try {
      const taskGroup = database.store.taskGroups.create({ name: 'inspect group', color: '#4D7C8A' });
      const task = database.store.tasks.create({
        title: 'inspect me',
        temperature: 'hot',
        groupId: taskGroup.id,
      });
      const goal = database.store.goals.create({ title: 'inspect goal' });
      const template = database.store.repeatTemplates.create({
        title: 'inspect repeat',
        cronExpr: '0 9 * * 1-5',
      });
      database.store.reviews.create({
        type: 'daily_plan',
        periodStart: '2026-08-23',
        periodEnd: '2026-08-23',
        content: { plannedTasks: [], carryoverDecisions: [] },
      });
      database.store.taskImages.create({
        taskId: task.id,
        fileName: 'inspect.png',
        mimeType: 'image/png',
        data: Buffer.alloc(12, 1),
      });
      database.store.tasks.softDelete(DEFAULT_TENANT_ID, task.id, task.version);

      const state = inspectState(database, 10);
      expect(state.tasks).toMatchObject({ total: 1, active: 0, softDeleted: 1 });
      expect(state.tasks.byStatus).toEqual({ archived: 1 });
      expect(state.tasks.recent).toEqual([
        expect.objectContaining({ id: task.id, groupId: taskGroup.id }),
      ]);
      expect(state.taskImages).toEqual({
        available: true,
        count: 1,
        totalBytes: 12,
        migrationHint: null,
      });
      expect(state.taskGroups).toMatchObject({
        total: 1,
        recent: [expect.objectContaining({ id: taskGroup.id, color: '#4D7C8A' })],
      });
      expect(state.events.total).toBe(7);
      expect(state.events.recent).toHaveLength(7);
      expect(state.goals).toMatchObject({ total: 1, active: 1, byStatus: { active: 1 } });
      expect(state.repeatTemplates).toMatchObject({ total: 1, enabled: 1 });
      expect(state.reviews).toMatchObject({ total: 1, byType: { daily_plan: 1 } });
      expect(goal.id).toBeTruthy();
      expect(template.id).toBeTruthy();
      expect(() => JSON.stringify(state)).not.toThrow();
    } finally {
      database.close();
    }
  });

  it('shows one chronological process row per stored event plus messages', () => {
    let tick = 0;
    const database = createDatabase({
      filename: ':memory:',
      now: () => new Date(Date.UTC(2026, 7, 23, 0, 0, tick++)),
    });
    try {
      const taskGroup = database.store.taskGroups.create({ name: 'timeline group', color: '#336699' });
      const task = database.store.tasks.create({ title: 'timeline', groupId: taskGroup.id });
      const predecessor = database.store.tasks.create({ title: 'predecessor' });
      database.store.dependencies.create({ predecessorId: predecessor.id, successorId: task.id });
      database.store.tasks.update(DEFAULT_TENANT_ID, task.id, task.version, { status: 'in_progress' });
      const run = database.store.aiRuns.start({ purpose: 'score', provider: 'fake', model: 'fake' });
      const card = database.store.cards.create({ type: 'observation', title: 'coach', body: 'body', targetTaskId: task.id, aiRunId: run.id });
      const conversation = database.store.conversations.create({ cardId: card.id });
      database.store.conversations.addMessage({ conversationId: conversation.id, role: 'user', content: 'why?' });

      const timeline = inspectTaskTimeline(database, task.id);
      expect(timeline.task).toMatchObject({ id: task.id, groupId: taskGroup.id });
      expect(timeline.events.map((event) => event.type)).toEqual([
        'task.created',
        'task_dependency.created',
        'task.updated',
        'ai_run.started',
        'card.created',
        'card.discussion_started',
        'conversation.created',
        'message.created',
      ]);
      expect(timeline.events[2]?.change).toContain('status: todo → in_progress');
      expect(timeline.messages).toMatchObject([{ role: 'user', content: 'why?' }]);
    } finally {
      database.close();
    }
  });

  it('reports a migration hint for a legacy database without creating task_images', () => {
    const database = createDatabase({ filename: ':memory:' });
    try {
      database.sqlite.exec('DROP TABLE task_images');
      const state = inspectState(database, 10);

      expect(state.taskImages).toMatchObject({
        available: false,
        count: 0,
        totalBytes: 0,
      });
      expect(state.taskImages.migrationHint).toContain('pnpm db:migrate');
      expect(
        database.sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'task_images'")
          .get(),
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
