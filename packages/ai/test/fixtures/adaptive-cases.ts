import type { AdaptiveEvaluationCase, PlanTask } from '../../src/index.js';

const now = '2026-08-27T00:00:00.000Z';
const morning = [{
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

export const adaptiveEvaluationCases: AdaptiveEvaluationCase[] = [
  {
    id: 'simple-user-order',
    request: {
      now, windows: morning, dependencies: [],
      tasks: [task('second', { rank: 2 }), task('first', { rank: 1 })],
    },
    expected: { status: 'ready', assignedTaskIds: ['first', 'second'] },
  },
  {
    id: 'dependency-before-successor',
    request: {
      now, windows: morning,
      tasks: [task('build'), task('test', { rank: -1 })],
      dependencies: [{ predecessorId: 'build', successorId: 'test' }],
    },
    expected: { status: 'ready', assignedTaskIds: ['build', 'test'] },
  },
  {
    id: 'deadline-propagates-through-chain',
    request: {
      now, windows: morning,
      tasks: [
        task('prepare', { estimatedMinutes: 60, rank: 10 }),
        task('deliver', { estimatedMinutes: 60, deadline: '2026-08-27T03:00:00.000Z' }),
        task('optional', { estimatedMinutes: 60, rank: -10 }),
      ],
      dependencies: [{ predecessorId: 'prepare', successorId: 'deliver' }],
    },
    expected: { status: 'ready', assignedTaskIds: ['prepare', 'deliver', 'optional'] },
  },
  {
    id: 'capacity-shortfall-is-infeasible',
    request: {
      now,
      windows: [{ id: 'tiny', start: now, end: '2026-08-27T00:30:00.000Z' }],
      tasks: [task('hard', { estimatedMinutes: 60, deadline: '2026-08-27T00:30:00.000Z' })],
      dependencies: [],
    },
    expected: { status: 'infeasible', violationCodes: ['DEADLINE_MISSED'] },
  },
  {
    id: 'cycle-rejected',
    request: {
      now, windows: morning, tasks: [task('a'), task('b')],
      dependencies: [
        { predecessorId: 'a', successorId: 'b' },
        { predecessorId: 'b', successorId: 'a' },
      ],
    },
    expected: { status: 'infeasible', violationCodes: ['DEPENDENCY_CYCLE'] },
  },
  {
    id: 'missing-snapshot-rejected',
    request: {
      now, windows: morning, tasks: [task('known')],
      dependencies: [{ predecessorId: 'unknown', successorId: 'known' }],
    },
    expected: { status: 'infeasible', violationCodes: ['MISSING_DEPENDENCY_TASK'] },
  },
  {
    id: 'overlap-rejected',
    request: {
      now,
      windows: [
        { id: 'one', start: now, end: '2026-08-27T02:00:00.000Z' },
        { id: 'two', start: '2026-08-27T01:00:00.000Z', end: '2026-08-27T03:00:00.000Z' },
      ],
      tasks: [task('safe')], dependencies: [],
    },
    expected: { status: 'infeasible', violationCodes: ['OVERLAPPING_WINDOWS'] },
  },
  {
    id: 'completed-predecessor-unblocks',
    request: {
      now, windows: morning,
      tasks: [task('done', { status: 'completed' }), task('next')],
      dependencies: [{ predecessorId: 'done', successorId: 'next' }],
    },
    expected: { status: 'ready', assignedTaskIds: ['next'] },
  },
  {
    id: 'authorization-boundary',
    request: {
      now, windows: morning,
      tasks: [task('visible'), task('private', { deadline: '2026-08-27T02:00:00.000Z' })],
      dependencies: [], allowedTaskIds: ['visible'],
    },
    expected: { status: 'ready', assignedTaskIds: ['visible'] },
  },
  {
    id: 'calibrated-duration-still-fits',
    request: {
      now, windows: morning, tasks: [task('learned', { estimatedMinutes: 30 })], dependencies: [],
      durationHistory: [
        { estimatedMinutes: 30, actualMinutes: 45 },
        { estimatedMinutes: 60, actualMinutes: 90 },
        { estimatedMinutes: 40, actualMinutes: 60 },
      ],
    },
    expected: { status: 'ready', assignedTaskIds: ['learned'] },
  },
  {
    id: 'soft-overflow-is-honest-deferral',
    request: {
      now,
      windows: [{ id: 'one-hour', start: now, end: '2026-08-27T01:00:00.000Z' }],
      tasks: [task('first', { estimatedMinutes: 45, rank: 1 }), task('later', { estimatedMinutes: 45, rank: 2 })],
      dependencies: [],
    },
    expected: { status: 'ready', assignedTaskIds: ['first'] },
  },
  {
    id: 'invalid-now-does-not-mutate',
    request: {
      now: 'not-a-time', windows: morning, tasks: [task('safe')], dependencies: [],
    },
    expected: { status: 'infeasible', violationCodes: ['INVALID_NOW'] },
  },
  {
    id: 'invalid-input-respects-authorization',
    request: {
      now,
      windows: [{ id: 'invalid', start: now, end: now }],
      tasks: [task('visible'), task('private')], dependencies: [],
      allowedTaskIds: ['visible'],
    },
    expected: { status: 'infeasible', violationCodes: ['INVALID_WINDOW'] },
  },
];
