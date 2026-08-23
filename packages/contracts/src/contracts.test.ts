import { describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  CreateTaskInputSchema,
  LocalDateSchema,
  RuleProposalSchema,
  TaskDtoSchema,
  UpdateTaskInputSchema,
} from './index.js';

describe('task contracts', () => {
  it('normalizes a minimal create request and applies stable defaults', () => {
    const input = CreateTaskInputSchema.parse({ title: '  Ship MVP  ' });

    expect(input).toEqual({
      title: 'Ship MVP',
      description: null,
      temperature: 'inspiration',
      status: 'todo',
      tags: [],
      deadline: null,
      plannedDate: null,
      startAt: null,
      endAt: null,
      estimatedMinutes: null,
      scoreDimensions: null,
    });
  });

  it('accepts bounded manual score dimensions on create', () => {
    const dimensions = { impact: 80, urgency: 60, alignment: 90, effort: 40 };
    expect(CreateTaskInputSchema.parse({ title: 'Manual score', scoreDimensions: dimensions }).scoreDimensions).toEqual(dimensions);
    expect(CreateTaskInputSchema.safeParse({ title: 'Invalid score', scoreDimensions: { ...dimensions, impact: 101 } }).success).toBe(false);
  });

  it('rejects duplicate normalized tags, unknown fields, and empty updates', () => {
    expect(CreateTaskInputSchema.safeParse({ title: 'x', tags: ['work', 'work'] }).success).toBe(
      false,
    );
    expect(CreateTaskInputSchema.safeParse({ title: 'x', extra: true }).success).toBe(false);
    expect(UpdateTaskInputSchema.safeParse({}).success).toBe(false);
  });

  it('validates real local calendar dates', () => {
    expect(LocalDateSchema.safeParse('2024-02-29').success).toBe(true);
    expect(LocalDateSchema.safeParse('2026-02-29').success).toBe(false);
  });

  it('keeps hardness as an API projection', () => {
    const parsed = TaskDtoSchema.parse({
      id: 'task-1',
      tenantId: 'tenant-1',
      ownerId: 'user-1',
      title: 'Ship',
      description: null,
      temperature: 'hot',
      status: 'todo',
      tags: [],
      deadline: '2026-08-25T09:00:00+08:00',
      plannedDate: '2026-08-23',
      startAt: null,
      endAt: null,
      estimatedMinutes: 60,
      actualMinutes: 0,
      scoreDimensions: null,
      score: null,
      rank: 1_000,
      version: 1,
      createdAt: '2026-08-23T08:00:00+08:00',
      updatedAt: '2026-08-23T08:00:00+08:00',
      completedAt: null,
      deletedAt: null,
      hardness: 'hard',
    });

    expect(parsed.hardness).toBe('hard');
  });
});

describe('shared response contracts', () => {
  it('validates the stable API error envelope', () => {
    expect(
      ApiErrorSchema.parse({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: [{ path: 'title', message: 'Required' }],
          correlationId: 'request-1',
        },
      }).error.code,
    ).toBe('VALIDATION_ERROR');
  });

  it('validates a rule proposal consumed by API and Web', () => {
    const proposal = RuleProposalSchema.parse({
      ruleId: 'deadline-auto-heat',
      taskId: 'task-1',
      effectiveDate: '2026-08-23',
      idempotencyKey: 'deadline-auto-heat:task-1:2026-08-23',
      reason: 'Deadline is close',
      action: { type: 'change_temperature', value: 'hot', requireConfirmation: false },
    });

    expect(proposal.action.type).toBe('change_temperature');
  });
});
