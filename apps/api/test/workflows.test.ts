import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTask, createTestHarness, type TestHarness } from './harness.js';

describe('card, rule, and conversation API', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  it('applies auto heat and creates each confirmed proposal card once', async () => {
    const hard = await createTask(harness.app, {
      title: 'Close deadline',
      temperature: 'cold',
      deadline: '2026-08-24',
    });
    const friday = await createTask(harness.app, {
      title: 'Friday carry-over',
      temperature: 'hot',
    });

    const first = await harness.app.inject({ method: 'POST', url: '/api/v1/rules/evaluate' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ appliedTaskIds: [hard.id] });

    const heated = await harness.app.inject({ method: 'GET', url: `/api/v1/tasks/${hard.id}` });
    expect(heated.json().temperature).toBe('hot');
    const cards = await harness.app.inject({ method: 'GET', url: '/api/v1/cards' });
    expect(cards.json().items).toHaveLength(1);
    expect(cards.json().items[0]).toMatchObject({ targetTaskId: friday.id, type: 'action' });

    const cooled = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${hard.id}`,
      payload: { version: heated.json().version, patch: { temperature: 'warm' } },
    });
    expect(cooled.statusCode).toBe(200);
    await harness.app.inject({ method: 'POST', url: '/api/v1/rules/evaluate' });
    const afterRepeat = await harness.app.inject({ method: 'GET', url: `/api/v1/tasks/${hard.id}` });
    expect(afterRepeat.json().temperature).toBe('warm');
    const repeatedCards = await harness.app.inject({ method: 'GET', url: '/api/v1/cards' });
    expect(repeatedCards.json().items).toHaveLength(1);
  });

  it('serializes concurrent rule evaluation without duplicate cards', async () => {
    await createTask(harness.app, { title: 'Concurrent Friday task', temperature: 'hot' });
    const responses = await Promise.all([
      harness.app.inject({ method: 'POST', url: '/api/v1/rules/evaluate' }),
      harness.app.inject({ method: 'POST', url: '/api/v1/rules/evaluate' }),
    ]);

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    const cards = await harness.app.inject({ method: 'GET', url: '/api/v1/cards' });
    expect(cards.json().items).toHaveLength(1);
  });

  it('accepts a proposal atomically and keeps repeated accept idempotent', async () => {
    const task = await createTask(harness.app, {
      title: 'Friday carry-over',
      temperature: 'hot',
    });
    await harness.app.inject({ method: 'POST', url: '/api/v1/rules/evaluate' });
    const card = (await harness.app.inject({ method: 'GET', url: '/api/v1/cards' })).json().items[0];

    const accepted = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/cards/${card.id}/decision`,
      payload: { decision: 'accept' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().status).toBe('accepted');
    expect(
      (await harness.app.inject({ method: 'GET', url: `/api/v1/tasks/${task.id}` })).json()
        .temperature,
    ).toBe('warm');

    const beforeEvents = (
      await harness.app.inject({ method: 'GET', url: `/api/v1/tasks/${task.id}/events` })
    ).json().items.length;
    const repeated = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/cards/${card.id}/decision`,
      payload: { decision: 'accept' },
    });
    const afterEvents = (
      await harness.app.inject({ method: 'GET', url: `/api/v1/tasks/${task.id}/events` })
    ).json().items.length;
    expect(repeated.statusCode).toBe(200);
    expect(afterEvents).toBe(beforeEvents);
  });

  it('rejects and dismisses cards without changing their tasks', async () => {
    const first = await createTask(harness.app, { title: 'Reject me', temperature: 'hot' });
    const second = await createTask(harness.app, { title: 'Dismiss me', temperature: 'hot' });
    await harness.app.inject({ method: 'POST', url: '/api/v1/rules/evaluate' });
    const cards = (await harness.app.inject({ method: 'GET', url: '/api/v1/cards' })).json().items;

    const rejected = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/cards/${cards[0].id}/decision`,
      payload: { decision: 'reject' },
    });
    const dismissed = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/cards/${cards[1].id}/decision`,
      payload: { version: cards[1].version, status: 'dismissed' },
    });

    expect(rejected.json().status).toBe('rejected');
    expect(dismissed.json().status).toBe('dismissed');
    expect(harness.database.store.tasks.get(first.tenantId, first.id)?.temperature).toBe('hot');
    expect(harness.database.store.tasks.get(second.tenantId, second.id)?.temperature).toBe('hot');
  });

  it('uses deterministic card conversation ids and returns an assistant reply', async () => {
    await createTask(harness.app, { title: 'Friday carry-over', temperature: 'hot' });
    await harness.app.inject({ method: 'POST', url: '/api/v1/rules/evaluate' });
    const card = (await harness.app.inject({ method: 'GET', url: '/api/v1/cards' })).json().items[0];

    const discussed = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/cards/${card.id}/discuss`,
      payload: { message: '为什么建议降温？' },
    });
    expect(discussed.json().conversation.id).toBe(`card-${card.id}`);

    const reply = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/conversations/card-${card.id}/messages`,
      payload: { content: '帮我拆一下' },
    });
    expect(reply.statusCode).toBe(201);
    expect(reply.json().message).toMatchObject({ role: 'assistant' });

    const messages = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/conversations/card-${card.id}/messages`,
    });
    expect(messages.json().items.map((message: { role: string }) => message.role)).toEqual([
      'user',
      'user',
      'assistant',
    ]);
    const refreshedCard = (
      await harness.app.inject({ method: 'GET', url: '/api/v1/cards' })
    ).json().items[0];
    expect(refreshedCard.conversationId).toBe(`card-${card.id}`);
    expect(refreshedCard.messages.map((message: { role: string }) => message.role)).toEqual([
      'user',
      'user',
      'assistant',
    ]);
  });

  it('projects and updates rules using the Web contract', async () => {
    const listed = await harness.app.inject({ method: 'GET', url: '/api/v1/rules' });
    expect(listed.json().items).toHaveLength(3);
    const rule = listed.json().items[0];
    expect(rule).toEqual(expect.objectContaining({ parameters: expect.any(Object) }));

    const updated = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/rules/${rule.id}`,
      payload: { enabled: false },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().enabled).toBe(false);
  });
});
