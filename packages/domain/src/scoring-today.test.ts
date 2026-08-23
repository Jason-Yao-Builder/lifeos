import { describe, expect, it } from 'vitest';
import {
  calculateTaskScore,
  dateTimeToLocalDate,
  isTaskForToday,
  selectTodayTasks,
  type TodaySelectableTask,
} from './index.js';

describe('deterministic task scoring', () => {
  it('uses effort as a cost and returns reproducible contributions', () => {
    const result = calculateTaskScore({ impact: 80, urgency: 60, alignment: 100, effort: 20 });

    expect(result).toEqual({
      score: 79,
      normalizedWeights: { impact: 0.35, urgency: 0.3, alignment: 0.25, effort: 0.1 },
      contributions: { impact: 28, urgency: 18, alignment: 25, effort: 8 },
    });
  });

  it('normalizes custom weights before scoring', () => {
    const result = calculateTaskScore(
      { impact: 20, urgency: 80, alignment: 40, effort: 100 },
      { impact: 1, urgency: 1, alignment: 0, effort: 0 },
    );

    expect(result.score).toBe(50);
    expect(result.normalizedWeights).toEqual({
      impact: 0.5,
      urgency: 0.5,
      alignment: 0,
      effort: 0,
    });
  });

  it('rejects out-of-range dimensions and all-zero weights', () => {
    expect(() =>
      calculateTaskScore({ impact: 101, urgency: 0, alignment: 0, effort: 0 }),
    ).toThrow();
    expect(() =>
      calculateTaskScore(
        { impact: 1, urgency: 1, alignment: 1, effort: 1 },
        { impact: 0, urgency: 0, alignment: 0, effort: 0 },
      ),
    ).toThrow();
  });
});

describe('today selection', () => {
  const base: TodaySelectableTask = {
    status: 'todo',
    plannedDate: null,
    deadline: null,
    deletedAt: null,
  };
  const options = { today: '2026-08-23' as const, timeZone: 'Asia/Shanghai' };

  it('converts instants at the configured timezone boundary', () => {
    expect(dateTimeToLocalDate('2026-08-22T16:30:00Z', 'Asia/Shanghai')).toBe('2026-08-23');
    expect(dateTimeToLocalDate('2026-08-22T16:30:00Z', 'UTC')).toBe('2026-08-22');
  });

  it('includes planned, due-today, and overdue active tasks', () => {
    const tasks = [
      { ...base, id: 'planned', plannedDate: '2026-08-23' as const },
      { ...base, id: 'due', deadline: '2026-08-22T16:30:00Z' },
      { ...base, id: 'overdue', deadline: '2026-08-20T09:00:00+08:00' },
      { ...base, id: 'future', deadline: '2026-08-24T09:00:00+08:00' },
    ];

    expect(selectTodayTasks(tasks, options).map((task) => task.id)).toEqual([
      'planned',
      'due',
      'overdue',
    ]);
  });

  it('excludes completed, deleted, and merely hot tasks', () => {
    expect(isTaskForToday({ ...base, status: 'completed', plannedDate: '2026-08-23' }, options)).toBe(
      false,
    );
    expect(isTaskForToday({ ...base, deletedAt: '2026-08-23T08:00:00+08:00' }, options)).toBe(
      false,
    );
    expect(isTaskForToday(base, options)).toBe(false);
  });
});
