import type { TaskRecord } from '@lifeos/contracts';
import { describe, expect, it } from 'vitest';
import { createDeterministicAI } from '../src/index.js';

const now = new Date('2026-08-23T08:00:00.000Z');

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-1',
    tenantId: 'local-workspace',
    ownerId: 'local-user',
    title: 'Ship MVP',
    description: null,
    temperature: 'hot',
    status: 'todo',
    tags: [],
    deadline: null,
    plannedDate: null,
    startAt: null,
    endAt: null,
    estimatedMinutes: 30,
    actualMinutes: 0,
    scoreDimensions: null,
    score: null,
    rank: 0,
    version: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    completedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

describe('deterministic AI', () => {
  const ai = createDeterministicAI({ now: () => now });

  it('uses the domain score formula and treats effort as cost', () => {
    const short = ai.scoreTask(task({ id: 'short', estimatedMinutes: 30 }));
    const long = ai.scoreTask(task({ id: 'long', estimatedMinutes: 300 }));
    const urgent = ai.scoreTask(task({ id: 'urgent', deadline: '2026-08-24T08:00:00.000Z' }));
    expect(short.dimensions.effort).toBeLessThan(long.dimensions.effort);
    expect(short.score).toBeGreaterThan(long.score);
    expect(urgent.score).toBeGreaterThan(short.score);
    expect(short.explanation).toContain('effort');
  });

  it('builds a transparent daily focus list', () => {
    const result = ai.dailySummary([
      task({ id: 'planned', title: 'Planned', plannedDate: '2026-08-23', temperature: 'warm' }),
      task({ id: 'hot', title: 'Hot', temperature: 'hot' }),
      task({ id: 'overdue', title: 'Overdue', temperature: 'cold', deadline: '2026-08-22T15:00:00.000Z' }),
      task({ id: 'cold', title: 'Cold', temperature: 'cold' }),
    ], '2026-08-23');
    expect(result.focusTaskIds).toContain('planned');
    expect(result.focusTaskIds).toContain('overdue');
    expect(result.focusTaskIds).not.toContain('hot');
    expect(result.focusTaskIds).not.toContain('cold');
    expect(result.explanation).toContain('四维评分');
  });

  it('uses persisted dimensions for summaries and coaching', () => {
    const manual = task({
      id: 'manual',
      title: 'Manual focus',
      plannedDate: '2026-08-23',
      temperature: 'cold',
      scoreDimensions: { impact: 100, urgency: 100, alignment: 100, effort: 0 },
      score: 100,
    });
    const automatic = task({
      id: 'automatic',
      title: 'Automatic focus',
      plannedDate: '2026-08-23',
      temperature: 'hot',
    });

    expect(ai.dailySummary([automatic, manual], '2026-08-23').focusTaskIds[0]).toBe('manual');
    expect(ai.reply({ messages: [{ role: 'user', content: '下一步做什么' }], tasks: [automatic, manual] }).content).toContain('Manual focus');
  });

  it('counts completion by workspace timezone', () => {
    const result = ai.dailySummary([
      task({
        id: 'done-after-midnight',
        status: 'completed',
        completedAt: '2026-08-22T16:30:00.000Z',
      }),
    ], '2026-08-23');
    expect(result.observations[0]).toContain('已完成 1 项');
  });

  it('creates observations only for active stale tasks', () => {
    const result = ai.stagnationObservations([
      task({ id: 'stale', updatedAt: '2026-08-10T00:00:00.000Z' }),
      task({ id: 'done', status: 'completed', updatedAt: '2026-08-01T00:00:00.000Z' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.targetTaskId).toBe('stale');
    expect(result[0]?.daysStale).toBe(13);
  });

  it('replies from task context without an external model', () => {
    const result = ai.reply({
      messages: [{ role: 'user', content: '帮我拆解任务' }],
      tasks: [task()],
    });
    expect(result.content).toContain('30 分钟');
    expect(result.explanation).toContain('未调用外部模型');
  });
});
