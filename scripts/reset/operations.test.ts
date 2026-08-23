import { describe, expect, it } from 'vitest';
import { createDatabase, DEFAULT_TENANT_ID } from '../../packages/db/src/index.js';
import { planTaskReset, resetAll, resetTask, workspaceCounts } from './operations.js';

describe('maintenance reset operations', () => {
  it('clears all workspace state and restores default rules', () => {
    const database = createDatabase({ filename: ':memory:' });
    try {
      const task = database.store.tasks.create({ title: 'reset me' });
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

      expect(workspaceCounts(database.sqlite)).toMatchObject({ tasks: 1, aiRuns: 1, cards: 1, conversations: 1, messages: 1, rules: 3 });
      const after = resetAll(database);

      expect(after).toEqual({ tasks: 0, events: 0, aiRuns: 0, cards: 0, conversations: 0, messages: 0, rules: 3 });
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
      const run = database.store.aiRuns.start({ purpose: 'shared-score', provider: 'fake', model: 'fake' });
      const targetCard = database.store.cards.create({ type: 'observation', title: 'target card', body: 'body', targetTaskId: target.id, aiRunId: run.id });
      const survivorCard = database.store.cards.create({ type: 'observation', title: 'survivor card', body: 'body', targetTaskId: survivor.id, aiRunId: run.id });
      const conversation = database.store.conversations.create({ cardId: targetCard.id });
      database.store.conversations.addMessage({ conversationId: conversation.id, role: 'user', content: 'remove me' });

      const plan = planTaskReset(database.sqlite, target.id);
      expect(plan).toMatchObject({ found: true, cards: [targetCard.id], conversations: [conversation.id], retainedAiRuns: [run.id], messages: 1 });
      resetTask(database, target.id);

      expect(database.store.tasks.get(DEFAULT_TENANT_ID, target.id)).toBeNull();
      expect(database.store.tasks.get(DEFAULT_TENANT_ID, survivor.id)?.title).toBe('survivor');
      expect(database.store.cards.get(DEFAULT_TENANT_ID, targetCard.id)).toBeNull();
      expect(database.store.cards.get(DEFAULT_TENANT_ID, survivorCard.id)?.id).toBe(survivorCard.id);
      expect(database.store.conversations.get(DEFAULT_TENANT_ID, conversation.id)).toBeNull();
      expect(database.store.aiRuns.get(DEFAULT_TENANT_ID, run.id)?.id).toBe(run.id);
      expect(database.store.events.forAggregate(DEFAULT_TENANT_ID, 'task', target.id)).toEqual([]);
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
});
