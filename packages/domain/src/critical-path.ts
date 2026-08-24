import { topologicallySortTaskIds, type DependencyEdge } from './dependencies.js';

const DAY_MS = 86_400_000;

export interface CriticalPathTask {
  id: string;
  startAt: string | null;
  endAt: string | null;
  estimatedMinutes?: number | null;
}

export interface CriticalPathResult {
  taskIds: string[];
  durationDays: number;
}

function taskDurationDays(task: CriticalPathTask): number {
  if (task.startAt && task.endAt) {
    const start = Date.parse(task.startAt);
    const end = Date.parse(task.endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      throw new RangeError(`Invalid task timespan: ${task.id}`);
    }
    return Math.max(1, Math.ceil((end - start) / DAY_MS));
  }
  if (task.estimatedMinutes && task.estimatedMinutes > 0) {
    return Math.max(1, Math.ceil(task.estimatedMinutes / 1_440));
  }
  return 1;
}

export function calculateCriticalPath(
  tasks: readonly CriticalPathTask[],
  edges: readonly DependencyEdge[],
): CriticalPathResult {
  if (tasks.length === 0) return { taskIds: [], durationDays: 0 };
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (byId.size !== tasks.length) throw new RangeError('Task ids must be unique');

  const ids = tasks.map((task) => task.id);
  const idSet = new Set(ids);
  const relevantEdges = edges.filter(
    (edge) => idSet.has(edge.predecessorId) && idSet.has(edge.successorId),
  );
  const incoming = new Map<string, string[]>();
  for (const edge of relevantEdges) {
    const predecessors = incoming.get(edge.successorId) ?? [];
    if (!predecessors.includes(edge.predecessorId)) predecessors.push(edge.predecessorId);
    incoming.set(edge.successorId, predecessors);
  }

  const distance = new Map<string, number>();
  const paths = new Map<string, string[]>();
  for (const taskId of topologicallySortTaskIds(ids, relevantEdges)) {
    const task = byId.get(taskId);
    if (!task) continue;
    let predecessorDistance = 0;
    let predecessorPath: string[] = [];
    for (const predecessorId of incoming.get(taskId) ?? []) {
      const candidateDistance = distance.get(predecessorId) ?? 0;
      if (candidateDistance > predecessorDistance) {
        predecessorDistance = candidateDistance;
        predecessorPath = paths.get(predecessorId) ?? [];
      }
    }
    distance.set(taskId, predecessorDistance + taskDurationDays(task));
    paths.set(taskId, [...predecessorPath, taskId]);
  }

  let terminalId = ids[0];
  for (const taskId of ids) {
    if ((distance.get(taskId) ?? 0) > (distance.get(terminalId ?? '') ?? 0)) terminalId = taskId;
  }
  if (!terminalId) return { taskIds: [], durationDays: 0 };
  return {
    taskIds: paths.get(terminalId) ?? [terminalId],
    durationDays: distance.get(terminalId) ?? 0,
  };
}
