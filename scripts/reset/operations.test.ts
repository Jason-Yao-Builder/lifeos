import { describe, expect, it } from 'vitest';
import { createDatabase, DEFAULT_TENANT_ID } from '../../packages/db/src/index.js';
import { planTaskReset, resetAll, resetTask, workspaceCounts } from './operations.js';

describe('maintenance reset operations', () => {
  it('clears all workspace state and restores default rules', () => {
    const database = createDatabase({ filename: ':memory:' });
    try {
      const goal = database.store.goals.create({ title: 'reset goal' });
      const taskGroup = database.store.taskGroups.create({ name: 'reset group', color: '#2F6B52' });
      const task = database.store.tasks.create({
        title: 'reset me',
        goalId: goal.id,
        groupId: taskGroup.id,
      });
      const predecessor = database.store.tasks.create({ title: 'dependency source' });
      database.store.taskImages.create({
        taskId: task.id,
        fileName: 'task.png',
        mimeType: 'image/png',
        data: Buffer.alloc(8, 1),
      });
      database.store.taskImages.create({
        taskId: predecessor.id,
        fileName: 'predecessor.png',
        mimeType: 'image/png',
        data: Buffer.alloc(6, 2),
      });
      database.store.dependencies.create({ predecessorId: predecessor.id, successorId: task.id });
      database.store.repeatTemplates.create({ title: 'repeat', cronExpr: '0 9 * * 1-5' });
      database.store.reviews.create({
        type: 'daily_plan',
        periodStart: '2026-08-23',
        periodEnd: '2026-08-23',
        content: { plannedTasks: [], carryoverDecisions: [] },
      });
      const run = database.store.aiRuns.start({ purpose: 'test', provider: 'fake', model: 'fake' });
      const card = database.store.cards.create({
        type: 'observation',
        title: 'card',
        body: 'body',
        targetTaskId: task.id,
        aiRunId: run.id,
      });
      const conversation = database.store.conversations.create({ cardId: card.id });
      database.store.conversations.addMessage({ conversationId: conversation.id, role: 'user', content: 'hello' });
      const rule = database.store.rules.list()[0]!;
      database.store.rules.update(DEFAULT_TENANT_ID, rule.id, rule.version, { enabled: false, config: { days: 99 } });

      expect(workspaceCounts(database.sqlite)).toMatchObject({
        tasks: 2,
        taskGroups: 1,
        aiRuns: 1,
        cards: 1,
        conversations: 1,
        messages: 1,
        rules: 3,
        goals: 1,
        dependencies: 1,
        repeatTemplates: 1,
        reviews: 1,
        taskImages: 2,
        taskImageBytes: 14,
        taskImagesAvailable: true,
      });
      const after = resetAll(database);

      expect(after).toEqual({
        tasks: 0,
        taskGroups: 0,
        events: 0,
        aiRuns: 0,
        cards: 0,
        conversations: 0,
        messages: 0,
        rules: 3,
        goals: 0,
        dependencies: 0,
        repeatTemplates: 0,
        reviews: 0,
        taskImages: 0,
        taskImageBytes: 0,
        taskImagesAvailable: true,
      });
      expect(database.store.rules.list().find((item) => item.id === rule.id)).toMatchObject({ enabled: true, version: 1 });
      expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('removes one task process while retaining unrelated and shared AI state', () => {
    const database = createDatabase({ filename: ':memory:' });
    try {
      const target = database.store.tasks.create({ title: 'target' });
      const survivor = database.store.tasks.create({ title: 'survivor' });
      database.store.taskImages.create({
        taskId: target.id,
        fileName: 'target-a.png',
        mimeType: 'image/png',
        data: Buffer.alloc(8, 1),
      });
      database.store.taskImages.create({
        taskId: target.id,
        fileName: 'target-b.png',
        mimeType: 'image/png',
        data: Buffer.alloc(10, 2),
      });
      database.store.taskImages.create({
        taskId: survivor.id,
        fileName: 'survivor.png',
        mimeType: 'image/png',
        data: Buffer.alloc(9, 3),
      });
      const dependency = database.store.dependencies.create({
        predecessorId: survivor.id,
        successorId: target.id,
      });
      const run = database.store.aiRuns.start({ purpose: 'shared-score', provider: 'fake', model: 'fake' });
      const targetCard = database.store.cards.create({ type: 'observation', title: 'target card', body: 'body', targetTaskId: target.id, aiRunId: run.id });
      const survivorCard = database.store.cards.create({ type: 'observation', title: 'survivor card', body: 'body', targetTaskId: survivor.id, aiRunId: run.id });
      const conversation = database.store.conversations.create({ cardId: targetCard.id });
      database.store.conversations.addMessage({ conversationId: conversation.id, role: 'user', content: 'remove me' });

      const plan = planTaskReset(database.sqlite, target.id);
      expect(plan).toMatchObject({
        found: true,
        cards: [targetCard.id],
        conversations: [conversation.id],
        dependencies: [dependency.id],
        retainedAiRuns: [run.id],
        messages: 1,
        taskImages: 2,
        taskImageBytes: 18,
        taskImagesAvailable: true,
      });
      resetTask(database, target.id);

      expect(database.store.tasks.get(DEFAULT_TENANT_ID, target.id)).toBeNull();
      expect(database.store.tasks.get(DEFAULT_TENANT_ID, survivor.id)?.title).toBe('survivor');
      expect(database.store.cards.get(DEFAULT_TENANT_ID, targetCard.id)).toBeNull();
      expect(database.store.cards.get(DEFAULT_TENANT_ID, survivorCard.id)?.id).toBe(survivorCard.id);
      expect(database.store.conversations.get(DEFAULT_TENANT_ID, conversation.id)).toBeNull();
      expect(database.store.aiRuns.get(DEFAULT_TENANT_ID, run.id)?.id).toBe(run.id);
      expect(
        database.sqlite
          .prepare('SELECT COUNT(*) count FROM task_images WHERE task_id = ?')
          .get(target.id),
      ).toEqual({ count: 0 });
      expect(database.store.taskImages.list(DEFAULT_TENANT_ID, survivor.id)).toHaveLength(1);
      expect(database.store.events.forAggregate(DEFAULT_TENANT_ID, 'task', target.id)).toEqual([]);
      expect(database.store.events.forAggregate(DEFAULT_TENANT_ID, 'task_dependency', dependency.id)).toEqual([]);
      expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('does not mutate when a task is unknown', () => {
    const database = createDatabase({ filename: ':memory:' });
    try {
      const before = workspaceCounts(database.sqlite);
      expect(planTaskReset(database.sqlite, 'missing')).toMatchObject({ found: false });
      expect(() => resetTask(database, 'missing')).toThrow('Task not found');
      expect(workspaceCounts(database.sqlite)).toEqual(before);
    } finally {
      database.close();
    }
  });

  it('keeps reset compatible with an unmigrated database without creating the image table', () => {
    const database = createDatabase({ filename: ':memory:' });
    try {
      const task = database.store.tasks.create({ title: 'legacy task' });
      database.sqlite.exec('DROP TABLE task_images');

      expect(workspaceCounts(database.sqlite)).toMatchObject({
        taskImages: 0,
        taskImageBytes: 0,
        taskImagesAvailable: false,
      });
      expect(planTaskReset(database.sqlite, task.id)).toMatchObject({
        found: true,
        taskImages: 0,
        taskImageBytes: 0,
        taskImagesAvailable: false,
      });
      resetTask(database, task.id);
      database.store.tasks.create({ title: 'legacy full reset' });
      expect(resetAll(database)).toMatchObject({
        tasks: 0,
        taskImages: 0,
        taskImageBytes: 0,
        taskImagesAvailable: false,
      });
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
