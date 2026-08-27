import { describe, expect, it } from 'vitest';
import { compileAdaptivePlan, validateAdaptivePlanForCommit } from '../src/index.js';
import type { PlanTask } from '../src/index.js';

function task(id: string, overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id, title: id, status: 'todo', deadline: null, plannedDate: null,
    estimatedMinutes: 30, actualMinutes: 0, goalId: null, parentTaskId: null,
    rank: 0, version: 1, createdAt: '2026-08-01T00:00:00.000Z', deletedAt: null,
    ...overrides,
  };
}

const now = '2026-08-27T00:00:00.000Z';
const windows = [{ id: 'work', start: now, end: '2026-08-27T02:00:00.000Z' }];

describe('adaptive plan approval gate', () => {
  it('accepts a fresh proposal whose dependencies still hold', () => {
    const tasks = [task('before'), task('after')];
    const dependencies = [{ predecessorId: 'before', successorId: 'after' }];
    const proposal = compileAdaptivePlan({ now, windows, tasks, dependencies });

    expect(validateAdaptivePlanForCommit(proposal, tasks, dependencies)).toEqual({
      success: true,
      proposal,
    });
  });

  it('rejects the entire proposal when any task version changed', () => {
    const tasks = [task('one'), task('two')];
    const proposal = compileAdaptivePlan({ now, windows, tasks, dependencies: [] });
    const current = [tasks[0] as PlanTask, task('two', { version: 2 })];
    const result = validateAdaptivePlanForCommit(proposal, current, []);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toContainEqual(expect.objectContaining({
        code: 'STALE_TASK_VERSION', taskIds: ['two'],
      }));
    }
  });

  it('rejects tampered overlap and dependency order', () => {
    const tasks = [task('before'), task('after')];
    const dependencies = [{ predecessorId: 'before', successorId: 'after' }];
    const proposal = compileAdaptivePlan({ now, windows, tasks, dependencies });
    const tampered = structuredClone(proposal);
    const before = tampered.assignments.find((item) => item.taskId === 'before');
    const after = tampered.assignments.find((item) => item.taskId === 'after');
    if (before && after) after.start = before.start;
    const result = validateAdaptivePlanForCommit(tampered, tasks, dependencies);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((item) => item.code)).toEqual(
        expect.arrayContaining(['OVERLAPPING_ASSIGNMENTS', 'DEPENDENCY_ORDER']),
      );
    }
  });
});
