import { describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  CreateSubtaskInputSchema,
  CreateTaskGroupInputSchema,
  CreateTaskInputSchema,
  LocalDateSchema,
  RuleProposalSchema,
  TaskDtoSchema,
  TaskGroupSchema,
  UpdateTaskGroupInputSchema,
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
      groupId: null,
      goalId: null,
      repeatTemplateId: null,
      parentTaskId: null,
      plannedStartTime: null,
      plannedEndTime: null,
      carryOverFrom: null,
      scoreDimensions: null,
    });
  });

  it('accepts bounded manual score dimensions on create', () => {
    const dimensions = { impact: 80, urgency: 60, alignment: 90, effort: 40 };
    expect(CreateTaskInputSchema.parse({ title: 'Manual score', scoreDimensions: dimensions }).scoreDimensions).toEqual(dimensions);
    expect(CreateTaskInputSchema.safeParse({ title: 'Invalid score', scoreDimensions: { ...dimensions, impact: 101 } }).success).toBe(false);
  });

  it('keeps subtask score inheritance server-owned', () => {
    expect(CreateSubtaskInputSchema.parse({ title: 'Child' })).toEqual(
      expect.not.objectContaining({ scoreDimensions: expect.anything() }),
    );
    expect(CreateSubtaskInputSchema.safeParse({
      title: 'Forged child score',
      scoreDimensions: { impact: 1, urgency: 2, alignment: 3, effort: 4 },
    }).success).toBe(false);
  });

  it('accepts bounded manual score dimensions on update without an ambiguous clear', () => {
    const dimensions = { impact: 90, urgency: 60, alignment: 90, effort: 40 };
    expect(UpdateTaskInputSchema.parse({ scoreDimensions: dimensions })).toEqual({ scoreDimensions: dimensions });
    expect(UpdateTaskInputSchema.safeParse({ scoreDimensions: null }).success).toBe(false);
    expect(UpdateTaskInputSchema.safeParse({ scoreDimensions: { ...dimensions, urgency: -1 } }).success).toBe(false);
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
      groupId: null,
      goalId: null,
      repeatTemplateId: null,
      parentTaskId: null,
      plannedStartTime: null,
      plannedEndTime: null,
      carryOverFrom: null,
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
      isBlocked: false,
    });

    expect(parsed.hardness).toBe('hard');
  });
});

describe('task group contracts', () => {
  it('trims names, normalizes colors, and stays strict', () => {
    expect(CreateTaskGroupInputSchema.parse({ name: '  Work  ', color: '#a1b2c3' }))
      .toEqual({ name: 'Work', color: '#A1B2C3' });
    expect(CreateTaskGroupInputSchema.safeParse({ name: 'Work', color: '#12345' }).success)
      .toBe(false);
    expect(CreateTaskGroupInputSchema.safeParse({ name: 'Work', color: '#123456', extra: true }).success)
      .toBe(false);
    expect(UpdateTaskGroupInputSchema.safeParse({}).success).toBe(false);
  });

  it('validates stable task group metadata', () => {
    const group = TaskGroupSchema.parse({
      id: 'group-1',
      workspaceId: 'workspace-1',
      name: 'Work',
      color: '#aabbcc',
      createdAt: '2026-08-24T08:00:00.000Z',
      updatedAt: '2026-08-24T08:00:00.000Z',
    });
    expect(group.color).toBe('#AABBCC');
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
