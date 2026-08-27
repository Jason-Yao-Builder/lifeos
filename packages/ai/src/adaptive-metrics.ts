import type {
  AdaptivePlanMetrics,
  PlanDependency,
  PlanTask,
  PreviousAssignment,
  ScheduleAssignment,
} from './adaptive-types.js';

interface MetricInput {
  activeTasks: readonly PlanTask[];
  assignments: readonly ScheduleAssignment[];
  dependencies: readonly PlanDependency[];
  previousAssignments: readonly PreviousAssignment[];
  capacityMinutes: number;
  calibrationFactor: number;
  horizonEnd: number;
}

export function calculateAdaptivePlanMetrics(input: MetricInput): AdaptivePlanMetrics {
  const assignmentByTask = new Map(input.assignments.map((item) => [item.taskId, item]));
  const hardTasks = input.activeTasks.filter((task) => {
    const deadline = task.deadline ? Date.parse(task.deadline) : Number.POSITIVE_INFINITY;
    return Number.isFinite(deadline) && deadline <= input.horizonEnd;
  });
  const protectedDeadlines = hardTasks.filter((task) => {
    const assignment = assignmentByTask.get(task.id);
    return assignment !== undefined && Date.parse(assignment.end) <= Date.parse(task.deadline ?? '');
  }).length;

  const relevantEdges = input.dependencies.filter(
    (edge) => assignmentByTask.has(edge.predecessorId) && assignmentByTask.has(edge.successorId),
  );
  const orderedEdges = relevantEdges.filter((edge) => {
    const predecessor = assignmentByTask.get(edge.predecessorId);
    const successor = assignmentByTask.get(edge.successorId);
    return Date.parse(predecessor?.end ?? '') <= Date.parse(successor?.start ?? '');
  }).length;

  const previousByTask = new Map(input.previousAssignments.map((item) => [item.taskId, item]));
  const comparable = input.assignments.filter((item) => previousByTask.has(item.taskId));
  const changed = comparable.filter((item) => {
    const previous = previousByTask.get(item.taskId);
    return Math.abs(Date.parse(item.start) - Date.parse(previous?.start ?? '')) > 300_000;
  }).length;
  const scheduledMinutes = input.assignments.reduce(
    (total, item) => total + item.durationMinutes,
    0,
  );
  const explained = input.assignments.filter(
    (item) => item.reasonCodes.length > 0 && item.explanation.trim().length > 0,
  ).length;

  return {
    activeTaskCount: input.activeTasks.length,
    scheduledTaskCount: input.assignments.length,
    capacityMinutes: input.capacityMinutes,
    scheduledMinutes,
    capacityUtilization: input.capacityMinutes === 0 ? 0 : scheduledMinutes / input.capacityMinutes,
    hardDeadlineProtection: hardTasks.length === 0 ? 1 : protectedDeadlines / hardTasks.length,
    dependencyOrderAccuracy: relevantEdges.length === 0 ? 1 : orderedEdges / relevantEdges.length,
    explanationCoverage: input.assignments.length === 0 ? 1 : explained / input.assignments.length,
    churnRate: comparable.length === 0 ? 0 : changed / comparable.length,
    durationCalibrationFactor: input.calibrationFactor,
  };
}
