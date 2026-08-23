import type { TaskRecord } from '@lifeos/contracts';
import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  InvalidTransitionError,
  assertValidTaskInput,
  canTransitionTaskStatus,
  getTaskHardness,
  transitionTaskStatus,
  validateCreateTaskInput,
  validateUpdateTaskInput,
} from './index.js';

const task: TaskRecord = {
  id: 'task-1',
  tenantId: 'tenant-1',
  ownerId: 'user-1',
  title: 'Ship MVP',
  description: null,
  temperature: 'hot',
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
  createdAt: '2026-08-23T08:00:00+08:00',
  updatedAt: '2026-08-23T08:00:00+08:00',
  completedAt: null,
  deletedAt: null,
};

describe('task input validation', () => {
  it('parses and normalizes valid input', () => {
    const result = validateCreateTaskInput({ title: '  Ship MVP  ', tags: ['work'] });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Ship MVP');
      expect(result.data.temperature).toBe('inspiration');
    }
  });

  it('rejects invalid ranges and exposes stable issues', () => {
    const result = validateCreateTaskInput({
      title: 'Invalid range',
      startAt: '2026-08-24T09:00:00+08:00',
      endAt: '2026-08-23T09:00:00+08:00',
      deadline: '2026-08-22T09:00:00+08:00',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((issue) => [issue.path, issue.code])).toEqual([
        ['endAt', 'INVALID_TIME_RANGE'],
        ['deadline', 'INVALID_TIME_RANGE'],
      ]);
    }
  });

  it('checks an update against unchanged temporal fields', () => {
    const result = validateUpdateTaskInput(
      { startAt: '2026-08-25T09:00:00+08:00' },
      {
        startAt: null,
        endAt: '2026-08-24T09:00:00+08:00',
        deadline: null,
      },
    );

    expect(result.success).toBe(false);
  });

  it('offers throwing validation and derives hardness only from deadline', () => {
    expect(() => assertValidTaskInput({ title: '' })).toThrow(DomainValidationError);
    expect(getTaskHardness(task)).toBe('soft');
    expect(getTaskHardness({ deadline: '2026-08-25T09:00:00+08:00' })).toBe('hard');
  });
});

describe('task status transitions', () => {
  it('allows forward progress and explicit restoration to todo', () => {
    expect(canTransitionTaskStatus('todo', 'in_progress')).toBe(true);
    expect(canTransitionTaskStatus('todo', 'completed')).toBe(false);
    expect(canTransitionTaskStatus('completed', 'archived')).toBe(true);
    expect(canTransitionTaskStatus('completed', 'todo')).toBe(true);
    expect(canTransitionTaskStatus('archived', 'todo')).toBe(true);
  });

  it('returns a new task and increments its version', () => {
    const next = transitionTaskStatus(task, 'in_progress', '2026-08-23T09:00:00+08:00');

    expect(next).not.toBe(task);
    expect(next).toMatchObject({ status: 'in_progress', version: 2 });
    expect(task.status).toBe('todo');
  });

  it('sets completion time and rejects an illegal jump', () => {
    const started = { ...task, status: 'in_progress' as const };
    const completed = transitionTaskStatus(started, 'completed', '2026-08-23T10:00:00+08:00');

    expect(completed.completedAt).toBe('2026-08-23T10:00:00+08:00');
    expect(
      transitionTaskStatus(completed, 'todo', '2026-08-23T11:00:00+08:00').completedAt,
    ).toBeNull();
    expect(() => transitionTaskStatus(task, 'completed', '2026-08-23T10:00:00+08:00')).toThrow(
      InvalidTransitionError,
    );
  });
});
