export interface DependencyEdge {
  predecessorId: string;
  successorId: string;
}

export class DependencyCycleError extends Error {
  readonly code = 'DEPENDENCY_CYCLE';

  constructor() {
    super('Task dependency graph contains a cycle');
    this.name = 'DependencyCycleError';
  }
}

function adjacencyFor(edges: readonly DependencyEdge[]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    const successors = adjacency.get(edge.predecessorId) ?? new Set<string>();
    successors.add(edge.successorId);
    adjacency.set(edge.predecessorId, successors);
    if (!adjacency.has(edge.successorId)) adjacency.set(edge.successorId, new Set());
  }
  return adjacency;
}

export function hasDependencyCycle(edges: readonly DependencyEdge[]): boolean {
  const adjacency = adjacencyFor(edges);
  const state = new Map<string, 0 | 1 | 2>();

  function visit(taskId: string): boolean {
    const current = state.get(taskId) ?? 0;
    if (current === 1) return true;
    if (current === 2) return false;
    state.set(taskId, 1);
    for (const successorId of adjacency.get(taskId) ?? []) {
      if (visit(successorId)) return true;
    }
    state.set(taskId, 2);
    return false;
  }

  return [...adjacency.keys()].some((taskId) => visit(taskId));
}

export function wouldCreateDependencyCycle(
  edges: readonly DependencyEdge[],
  candidate: DependencyEdge,
): boolean {
  if (candidate.predecessorId === candidate.successorId) return true;
  return hasDependencyCycle([...edges, candidate]);
}

export function assertAcyclicDependencies(edges: readonly DependencyEdge[]): void {
  if (hasDependencyCycle(edges)) throw new DependencyCycleError();
}

export function topologicallySortTaskIds(
  taskIds: readonly string[],
  edges: readonly DependencyEdge[],
): string[] {
  const uniqueTaskIds = [...new Set(taskIds)];
  const taskSet = new Set(uniqueTaskIds);
  const relevantEdges = edges.filter(
    (edge) => taskSet.has(edge.predecessorId) && taskSet.has(edge.successorId),
  );
  if (hasDependencyCycle(relevantEdges)) throw new DependencyCycleError();

  const adjacency = adjacencyFor(relevantEdges);
  const indegree = new Map(uniqueTaskIds.map((id) => [id, 0]));
  for (const successors of adjacency.values()) {
    for (const successorId of successors) {
      indegree.set(successorId, (indegree.get(successorId) ?? 0) + 1);
    }
  }
  const queue = uniqueTaskIds.filter((id) => indegree.get(id) === 0);
  const result: string[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    const taskId = queue[index];
    if (taskId === undefined) continue;
    result.push(taskId);
    for (const successorId of adjacency.get(taskId) ?? []) {
      const next = (indegree.get(successorId) ?? 0) - 1;
      indegree.set(successorId, next);
      if (next === 0) queue.push(successorId);
    }
  }
  if (result.length !== uniqueTaskIds.length) throw new DependencyCycleError();
  return result;
}

export function isTaskBlocked(
  taskId: string,
  edges: readonly DependencyEdge[],
  completedTaskIds: ReadonlySet<string>,
): boolean {
  return edges.some(
    (edge) => edge.successorId === taskId && !completedTaskIds.has(edge.predecessorId),
  );
}
