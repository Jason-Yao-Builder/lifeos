import { describe, expect, it } from 'vitest';
import {
  DependencyCycleError,
  calculateCriticalPath,
  calculateSubtaskProgress,
  hasDependencyCycle,
  isTaskBlocked,
  topologicallySortTaskIds,
  wouldCreateDependencyCycle,
  type DependencyEdge,
} from './index.js';

describe('task dependency graph', () => {
  const edges: DependencyEdge[] = [
    { predecessorId: 'a', successorId: 'b' },
    { predecessorId: 'b', successorId: 'c' },
  ];

  it('detects direct, indirect, and candidate cycles with DFS', () => {
    expect(hasDependencyCycle(edges)).toBe(false);
    expect(
      wouldCreateDependencyCycle(edges, { predecessorId: 'c', successorId: 'a' }),
    ).toBe(true);
    expect(
      wouldCreateDependencyCycle(edges, { predecessorId: 'a', successorId: 'a' }),
    ).toBe(true);
    expect(
      wouldCreateDependencyCycle(edges, { predecessorId: 'a', successorId: 'c' }),
    ).toBe(false);
  });

  it('sorts a DAG and derives blocked state from unfinished predecessors', () => {
    expect(topologicallySortTaskIds(['c', 'b', 'a'], edges)).toEqual(['a', 'b', 'c']);
    expect(isTaskBlocked('b', edges, new Set())).toBe(true);
    expect(isTaskBlocked('b', edges, new Set(['a']))).toBe(false);
  });
});

describe('critical path and subtask progress', () => {
  it('returns the longest dependency chain by task duration', () => {
    const tasks = [
      {
        id: 'a',
        startAt: '2026-08-01T00:00:00Z',
        endAt: '2026-08-03T00:00:00Z',
      },
      {
        id: 'b',
        startAt: '2026-08-03T00:00:00Z',
        endAt: '2026-08-06T00:00:00Z',
      },
      {
        id: 'c',
        startAt: '2026-08-01T00:00:00Z',
        endAt: '2026-08-05T00:00:00Z',
      },
    ];
    expect(
      calculateCriticalPath(tasks, [{ predecessorId: 'a', successorId: 'b' }]),
    ).toEqual({ taskIds: ['a', 'b'], durationDays: 5 });
  });

  it('rejects cyclic CPM input and rounds two of three children to 67%', () => {
    const tasks = [
      { id: 'a', startAt: null, endAt: null },
      { id: 'b', startAt: null, endAt: null },
    ];
    expect(() =>
      calculateCriticalPath(tasks, [
        { predecessorId: 'a', successorId: 'b' },
        { predecessorId: 'b', successorId: 'a' },
      ]),
    ).toThrow(DependencyCycleError);
    expect(
      calculateSubtaskProgress([
        { status: 'completed' },
        { status: 'completed' },
        { status: 'in_progress' },
      ]),
    ).toEqual({ completed: 2, total: 3, percent: 67 });
    expect(calculateSubtaskProgress([])).toEqual({ completed: 0, total: 0, percent: 0 });
  });
});
