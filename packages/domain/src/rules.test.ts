import type { TaskRecord } from '@lifeos/contracts';
import { describe, expect, it } from 'vitest';
import { evaluatePresetRules } from './index.js';

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1',
    tenantId: 'tenant-1',
    ownerId: 'user-1',
    title: 'Ship MVP',
    description: null,
    temperature: 'warm',
    status: 'todo',
    tags: [],
    deadline: null,
    plannedDate: null,
    startAt: null,
    endAt: null,
    estimatedMinutes: null,
    actualMinutes: 0,
    scoreDimensions: null,
    score: null,
    rank: 1_000,
    version: 1,
    createdAt: '2026-08-20T09:00:00+08:00',
    updatedAt: '2026-08-20T09:00:00+08:00',
    completedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

describe('preset rule proposals', () => {
  const fridayContext = { now: '2026-08-21T09:00:00+08:00' };

  it('proposes automatic heat for a close deadline', () => {
    const proposals = evaluatePresetRules(
      [makeTask({ temperature: 'cold', deadline: '2026-08-24T09:00:00+08:00' })],
      fridayContext,
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      ruleId: 'deadline-auto-heat',
      effectiveDate: '2026-08-21',
      action: { type: 'change_temperature', value: 'hot', requireConfirmation: false },
    });
  });

  it('creates an observation proposal after the stale threshold', () => {
    const proposals = evaluatePresetRules(
      [makeTask({ updatedAt: '2026-08-12T09:00:00+08:00' })],
      fridayContext,
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      ruleId: 'stale-task-observation',
      action: { type: 'create_card', cardType: 'observation', requireConfirmation: false },
    });
  });

  it('proposes confirmed demotion for a Friday hot task', () => {
    const proposals = evaluatePresetRules(
      [makeTask({ temperature: 'hot', updatedAt: '2026-08-21T08:00:00+08:00' })],
      fridayContext,
    );

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      ruleId: 'friday-hot-demotion',
      action: { type: 'change_temperature', value: 'warm', requireConfirmation: true },
    });
  });

  it('does not demote a hot task whose deadline needs protection', () => {
    const proposals = evaluatePresetRules(
      [
        makeTask({
          temperature: 'hot',
          deadline: '2026-08-22T09:00:00+08:00',
          updatedAt: '2026-08-21T08:00:00+08:00',
        }),
      ],
      fridayContext,
    );

    expect(proposals).toEqual([]);
  });

  it('skips terminal and deleted tasks', () => {
    const proposals = evaluatePresetRules(
      [
        makeTask({ id: 'done', status: 'completed', deadline: '2026-08-22T09:00:00+08:00' }),
        makeTask({ id: 'deleted', deletedAt: '2026-08-21T08:00:00+08:00' }),
      ],
      fridayContext,
    );

    expect(proposals).toEqual([]);
  });

  it('builds deterministic daily idempotency keys', () => {
    const [proposal] = evaluatePresetRules(
      [makeTask({ temperature: 'cold', deadline: '2026-08-24T09:00:00+08:00' })],
      fridayContext,
    );

    expect(proposal?.idempotencyKey).toBe('deadline-auto-heat:task-1:2026-08-21');
  });

  it('rejects invalid rule thresholds', () => {
    expect(() => evaluatePresetRules([makeTask()], { ...fridayContext, staleDays: -1 })).toThrow(
      RangeError,
    );
  });
});
