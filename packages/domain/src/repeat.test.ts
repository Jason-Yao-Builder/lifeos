import { describe, expect, it } from 'vitest';
import {
  materializeRepeatTask,
  matchesCronDate,
  parseCronExpression,
  planRepeatInstances,
  type RepeatTemplateForGeneration,
} from './index.js';

const template: RepeatTemplateForGeneration = {
  id: 'repeat-1',
  title: 'Daily standup',
  description: 'Prepare notes',
  temperature: 'warm',
  tags: ['work'],
  estimatedMinutes: 15,
  goalId: 'goal-1',
  cronExpr: '0 9 * * 1-5',
  horizonDays: 28,
  enabled: true,
  lastGenerated: null,
};

describe('five-field cron matching', () => {
  it('parses ranges and matches local calendar weekdays', () => {
    expect(parseCronExpression(template.cronExpr)).toMatchObject({
      minutes: [0],
      hours: [9],
      daysOfWeek: [1, 2, 3, 4, 5],
    });
    expect(matchesCronDate(template.cronExpr, '2026-08-24')).toBe(true);
    expect(matchesCronDate(template.cronExpr, '2026-08-23')).toBe(false);
  });

  it('supports steps and rejects values outside field bounds', () => {
    expect(matchesCronDate('0 9 */2 * *', '2026-08-25')).toBe(true);
    expect(matchesCronDate('0 9 */2 * *', '2026-08-24')).toBe(false);
    expect(() => parseCronExpression('60 9 * * *')).toThrow();
  });
});

describe('28-day repeat instantiation planning', () => {
  it('plans four weeks, skips existing instances, and advances through today plus 27', () => {
    const plan = planRepeatInstances(template, {
      today: '2026-08-24',
      existingDates: ['2026-08-24'],
    });

    expect(plan.dates).toHaveLength(19);
    expect(plan.dates[0]).toBe('2026-08-25');
    expect(plan.dates.at(-1)).toBe('2026-09-18');
    expect(plan.lastGenerated).toBe('2026-09-20');
  });

  it('starts after lastGenerated and leaves disabled templates untouched', () => {
    const advanced = planRepeatInstances(
      { ...template, lastGenerated: '2026-08-28' },
      { today: '2026-08-24' },
    );
    expect(advanced.dates[0]).toBe('2026-08-31');
    expect(
      planRepeatInstances(
        { ...template, enabled: false, lastGenerated: '2026-08-20' },
        { today: '2026-08-24' },
      ),
    ).toEqual({ templateId: 'repeat-1', dates: [], lastGenerated: '2026-08-20' });
  });

  it('materializes an independent task snapshot from the template', () => {
    const task = materializeRepeatTask(template, '2026-08-24');
    expect(task).toMatchObject({
      title: 'Daily standup',
      plannedDate: '2026-08-24',
      repeatTemplateId: 'repeat-1',
      goalId: 'goal-1',
      status: 'todo',
    });
    expect(task.tags).not.toBe(template.tags);
  });
});
