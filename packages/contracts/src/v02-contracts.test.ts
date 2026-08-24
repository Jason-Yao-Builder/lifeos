import { describe, expect, it } from 'vitest';
import {
  CalendarResponseSchema,
  CarryoverDecisionSchema,
  CreateGoalInputSchema,
  CreateRepeatTemplateInputSchema,
  GanttResponseSchema,
  MonthlyReviewContentSchema,
  RescheduleTaskInputSchema,
  ReviewCardRecordSchema,
  TaskDependencyInputSchema,
  TaskScoreWeightsSchema,
  TaskTimespanInputSchema,
  UpdateGoalInputSchema,
} from './index.js';

describe('v0.2 entity contracts', () => {
  it('normalizes goals and repeat templates with frozen defaults', () => {
    expect(CreateGoalInputSchema.parse({ title: '  Annual plan  ' })).toEqual({
      title: 'Annual plan',
      description: null,
      timeframe: null,
      status: 'active',
    });
    expect(
      CreateRepeatTemplateInputSchema.parse({ title: 'Standup', cronExpr: '0 9 * * 1-5' }),
    ).toMatchObject({
      temperature: 'warm',
      timezone: 'Asia/Shanghai',
      horizonDays: 28,
      enabled: true,
    });
    expect(UpdateGoalInputSchema.safeParse({}).success).toBe(false);
    expect(
      CreateRepeatTemplateInputSchema.safeParse({ title: 'Bad', cronExpr: '0 9 * *' }).success,
    ).toBe(false);
    expect(
      CreateRepeatTemplateInputSchema.safeParse({ title: 'Bad', cronExpr: '60 9 * * *' }).success,
    ).toBe(false);
  });

  it('defaults dependencies to finish-to-start and strips legacy effort weights', () => {
    expect(TaskDependencyInputSchema.parse({ predecessorId: 'task-a' })).toEqual({
      predecessorId: 'task-a',
      type: 'finish_to_start',
    });
    expect(
      TaskScoreWeightsSchema.parse({ impact: 0.35, urgency: 0.3, alignment: 0.25, effort: 0.1 }),
    ).toEqual({ impact: 0.35, urgency: 0.3, alignment: 0.25 });
  });
});

describe('v0.2 view and workflow contracts', () => {
  it('requires a target date only for rescheduling carryover', () => {
    expect(
      CarryoverDecisionSchema.parse({
        taskId: 'task-1',
        action: 'reschedule',
        targetDate: '2026-08-26',
      }),
    ).toMatchObject({ targetDate: '2026-08-26' });
    expect(
      CarryoverDecisionSchema.safeParse({ taskId: 'task-1', action: 'reschedule' }).success,
    ).toBe(false);
    expect(
      CarryoverDecisionSchema.safeParse({
        taskId: 'task-1',
        action: 'carry_today',
        targetDate: '2026-08-26',
      }).success,
    ).toBe(false);
  });

  it('validates calendar and gantt response envelopes', () => {
    expect(CalendarResponseSchema.parse({ days: {} })).toEqual({ days: {} });
    expect(
      GanttResponseSchema.parse({ tasks: [], dependencies: [], criticalPath: [] }),
    ).toEqual({ tasks: [], dependencies: [], criticalPath: [] });
  });

  it('keeps optimistic-lock versions on date mutations and checks ranges', () => {
    expect(
      RescheduleTaskInputSchema.safeParse({ version: 1, plannedDate: '2026-08-25' }).success,
    ).toBe(true);
    expect(
      RescheduleTaskInputSchema.safeParse({
        version: 1,
        plannedDate: '2026-08-25',
        startAt: '2026-08-25T09:00:00+08:00',
        endAt: '2026-08-25T10:00:00+08:00',
      }).success,
    ).toBe(true);
    expect(
      TaskTimespanInputSchema.safeParse({
        version: 2,
        startsAt: '2026-08-25T09:00:00+08:00',
        endsAt: '2026-08-26T09:00:00+08:00',
      }).success,
    ).toBe(true);
    expect(
      TaskTimespanInputSchema.safeParse({
        version: 2,
        startAt: '2026-08-26T09:00:00+08:00',
        endAt: '2026-08-25T09:00:00+08:00',
      }).success,
    ).toBe(false);
  });

  it('binds review content to its review type', () => {
    const base = {
      id: 'review-1',
      workspaceId: 'workspace-1',
      ownerId: 'user-1',
      periodStart: '2026-08-24',
      periodEnd: '2026-08-24',
      createdAt: '2026-08-24T20:00:00+08:00',
      updatedAt: '2026-08-24T20:00:00+08:00',
    };
    expect(
      ReviewCardRecordSchema.parse({
        ...base,
        type: 'daily_plan',
        content: { plannedTasks: [], carryoverDecisions: [] },
      }).type,
    ).toBe('daily_plan');
    expect(
      ReviewCardRecordSchema.safeParse({
        ...base,
        type: 'daily_review',
        content: { plannedTasks: [], carryoverDecisions: [] },
      }).success,
    ).toBe(false);
  });

  it('requires weekly temperature snapshots in monthly reviews', () => {
    const content = {
      goals: [],
      taskCounts: { created: 1, completed: 0, abandoned: 0 },
      temperatureTrend: [
        {
          periodStart: '2026-08-01',
          periodEnd: '2026-08-02',
          byTemperature: { inspiration: 0, cold: 1, warm: 0, hot: 0 },
        },
      ],
      repeatCompletionRate: 0,
      frequentCarryovers: [],
    };
    expect(MonthlyReviewContentSchema.parse(content).temperatureTrend).toHaveLength(1);
    expect(
      MonthlyReviewContentSchema.safeParse({
        ...content,
        temperatureTrend: undefined,
      }).success,
    ).toBe(false);
  });
});
