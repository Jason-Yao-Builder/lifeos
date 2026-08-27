import type { PlanTask } from '../src/adaptive-types.js';
import { compileAdaptivePlan } from '../src/index.js';
import { describe, expect, it } from 'vitest';

const now = '2026-08-27T00:00:00.000Z';
const workday = [{
  id: 'morning',
  start: '2026-08-27T01:00:00.000Z',
  end: '2026-08-27T05:00:00.000Z',
}];

function task(id: string, overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id,
    title: id,
    status: 'todo',
    deadline: null,
    plannedDate: null,
    estimatedMinutes: 30,
    actualMinutes: 0,
    goalId: null,
    parentTaskId: null,
    rank: 0,
    version: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

describe('adaptive plan compiler', () => {
  it('protects a deadline while preserving dependency order', () => {
    const proposal = compileAdaptivePlan({
      now,
      windows: workday,
      tasks: [
        task('setup', { estimatedMinutes: 60, rank: 2 }),
        task('ship', {
          estimatedMinutes: 90,
          deadline: '2026-08-27T04:00:00.000Z',
          goalId: 'goal-1',
          rank: 1,
        }),
        task('optional', { estimatedMinutes: 60, rank: 0 }),
      ],
      dependencies: [{ predecessorId: 'setup', successorId: 'ship' }],
    });

    expect(proposal.status).toBe('ready');
    expect(proposal.assignments.map((item) => item.taskId)).toEqual(['setup', 'ship', 'optional']);
    expect(Date.parse(proposal.assignments[0]?.end ?? '')).toBeLessThanOrEqual(
      Date.parse(proposal.assignments[1]?.start ?? ''),
    );
    expect(proposal.metrics.hardDeadlineProtection).toBe(1);
    expect(proposal.metrics.dependencyOrderAccuracy).toBe(1);
    expect(proposal.assignments[1]?.reasonCodes).toContain('DEADLINE_AT_RISK');
  });

  it('refuses to call an overloaded plan feasible', () => {
    const proposal = compileAdaptivePlan({
      now,
      windows: [{ id: 'short', start: now, end: '2026-08-27T01:00:00.000Z' }],
      tasks: [task('hard', {
        estimatedMinutes: 90,
        deadline: '2026-08-27T01:00:00.000Z',
      })],
      dependencies: [],
    });

    expect(proposal.status).toBe('infeasible');
    expect(proposal.assignments).toHaveLength(0);
    expect(proposal.violations).toContainEqual(expect.objectContaining({ code: 'DEADLINE_MISSED' }));
    expect(proposal.metrics.hardDeadlineProtection).toBe(0);
  });

  it('rejects cycles and overlapping capacity without proposing changes', () => {
    const proposal = compileAdaptivePlan({
      now,
      windows: [
        { id: 'one', start: now, end: '2026-08-27T02:00:00.000Z' },
        { id: 'two', start: '2026-08-27T01:00:00.000Z', end: '2026-08-27T03:00:00.000Z' },
      ],
      tasks: [task('a'), task('b')],
      dependencies: [
        { predecessorId: 'a', successorId: 'b' },
        { predecessorId: 'b', successorId: 'a' },
      ],
    });

    expect(proposal.status).toBe('infeasible');
    expect(proposal.assignments).toHaveLength(0);
    expect(proposal.violations.map((item) => item.code)).toEqual(
      expect.arrayContaining(['DEPENDENCY_CYCLE', 'OVERLAPPING_WINDOWS']),
    );
  });

  it('never schedules outside the explicit authorization set', () => {
    const proposal = compileAdaptivePlan({
      now,
      windows: workday,
      tasks: [task('allowed'), task('private', { deadline: '2026-08-27T02:00:00.000Z' })],
      dependencies: [],
      allowedTaskIds: ['allowed'],
    });

    expect(proposal.assignments.map((item) => item.taskId)).toEqual(['allowed']);
    expect(proposal.deferredTaskIds).not.toContain('private');
  });

  it('does not reveal unauthorized task ids when validation fails early', () => {
    const proposal = compileAdaptivePlan({
      now,
      windows: [{ id: 'invalid', start: now, end: now }],
      tasks: [task('allowed'), task('private')],
      dependencies: [],
      allowedTaskIds: ['allowed'],
    });

    expect(proposal.status).toBe('infeasible');
    expect(proposal.deferredTaskIds).toEqual(['allowed']);
    expect(JSON.stringify(proposal)).not.toContain('private');
  });

  it('uses robust history calibration and exposes the reason', () => {
    const proposal = compileAdaptivePlan({
      now,
      windows: workday,
      tasks: [task('learned', { estimatedMinutes: 30 })],
      dependencies: [],
      durationHistory: [
        { estimatedMinutes: 30, actualMinutes: 60 },
        { estimatedMinutes: 60, actualMinutes: 120 },
        { estimatedMinutes: 45, actualMinutes: 90 },
        { estimatedMinutes: 20, actualMinutes: 40 },
        { estimatedMinutes: 50, actualMinutes: 100 },
        { estimatedMinutes: 90, actualMinutes: 180 },
        { estimatedMinutes: 30, actualMinutes: 3_000 },
      ],
    });

    expect(proposal.metrics.durationCalibrationFactor).toBe(2);
    expect(proposal.assignments[0]?.durationMinutes).toBe(60);
    expect(proposal.assignments[0]?.reasonCodes).toContain('ESTIMATE_CALIBRATED');
  });

  it('is deterministic and explains every assignment', () => {
    const request = {
      now,
      windows: workday,
      tasks: [task('b', { rank: 1 }), task('a', { rank: 1 })],
      dependencies: [],
    };
    const first = compileAdaptivePlan(request);
    const second = compileAdaptivePlan(request);

    expect(second).toEqual(first);
    expect(first.assignments.map((item) => item.taskId)).toEqual(['a', 'b']);
    expect(first.metrics.explanationCoverage).toBe(1);
    expect(first.assignments.every((item) => item.explanation.length > 0)).toBe(true);
  });

  it('reports missing dependency snapshots before planning', () => {
    const proposal = compileAdaptivePlan({
      now,
      windows: workday,
      tasks: [task('visible')],
      dependencies: [{ predecessorId: 'hidden', successorId: 'visible' }],
    });

    expect(proposal.assignments).toHaveLength(0);
    expect(proposal.violations).toContainEqual(expect.objectContaining({
      code: 'MISSING_DEPENDENCY_TASK',
      taskIds: ['hidden'],
    }));
  });

  it('keeps near-term commitments fixed and fills around them', () => {
    const proposal = compileAdaptivePlan({
      now,
      windows: [{ id: 'work', start: now, end: '2026-08-27T04:00:00.000Z' }],
      tasks: [task('new', { estimatedMinutes: 60 }), task('committed', { estimatedMinutes: 30 })],
      dependencies: [],
      previousAssignments: [{
        taskId: 'committed',
        start: '2026-08-27T02:00:00.000Z',
        end: '2026-08-27T02:30:00.000Z',
      }],
      freezeBefore: '2026-08-27T03:00:00.000Z',
    });

    expect(proposal.status).toBe('ready');
    expect(proposal.assignments.find((item) => item.taskId === 'committed')).toMatchObject({
      start: '2026-08-27T02:00:00.000Z',
      end: '2026-08-27T02:30:00.000Z',
    });
    expect(proposal.metrics.churnRate).toBe(0);
  });

  it('reports conflicting frozen commitments instead of moving them', () => {
    const proposal = compileAdaptivePlan({
      now,
      windows: [{ id: 'work', start: now, end: '2026-08-27T04:00:00.000Z' }],
      tasks: [task('one'), task('two')],
      dependencies: [],
      previousAssignments: [
        { taskId: 'one', start: '2026-08-27T01:00:00.000Z', end: '2026-08-27T02:00:00.000Z' },
        { taskId: 'two', start: '2026-08-27T01:30:00.000Z', end: '2026-08-27T02:30:00.000Z' },
      ],
      freezeBefore: '2026-08-27T03:00:00.000Z',
    });

    expect(proposal.status).toBe('infeasible');
    expect(proposal.assignments).toHaveLength(0);
    expect(proposal.violations).toContainEqual(expect.objectContaining({
      code: 'LOCKED_ASSIGNMENT_CONFLICT',
    }));
  });
});
