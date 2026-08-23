import { describe, expect, it } from 'vitest';
import { createDatabase, DEFAULT_TENANT_ID } from '../../packages/db/src/index.js';
import { inspectState, inspectTaskTimeline } from './queries.js';

describe('maintenance inspection queries', () => {
  it('prints complete state counts including soft-deleted tasks', () => {
    const database = createDatabase({ filename: ':memory:' });
    try {
      const task = database.store.tasks.create({ title: 'inspect me', temperature: 'hot' });
      database.store.tasks.softDelete(DEFAULT_TENANT_ID, task.id, task.version);

      const state = inspectState(database, 10);
      expect(state.tasks).toMatchObject({ total: 1, active: 0, softDeleted: 1 });
      expect(state.tasks.byStatus).toEqual({ archived: 1 });
      expect(state.events.total).toBe(2);
      expect(state.events.recent).toHaveLength(2);
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
      const task = database.store.tasks.create({ title: 'timeline' });
      database.store.tasks.update(DEFAULT_TENANT_ID, task.id, task.version, { status: 'in_progress' });
      const run = database.store.aiRuns.start({ purpose: 'score', provider: 'fake', model: 'fake' });
      const card = database.store.cards.create({ type: 'observation', title: 'coach', body: 'body', targetTaskId: task.id, aiRunId: run.id });
      const conversation = database.store.conversations.create({ cardId: card.id });
      database.store.conversations.addMessage({ conversationId: conversation.id, role: 'user', content: 'why?' });

      const timeline = inspectTaskTimeline(database, task.id);
      expect(timeline.events.map((event) => event.type)).toEqual([
        'task.created',
        'task.updated',
        'ai_run.started',
        'card.created',
        'card.discussion_started',
        'conversation.created',
        'message.created',
      ]);
      expect(timeline.events[1]?.change).toContain('status: todo → in_progress');
      expect(timeline.messages).toMatchObject([{ role: 'user', content: 'why?' }]);
    } finally {
      database.close();
    }
  });
});
