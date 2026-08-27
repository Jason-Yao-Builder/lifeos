import type {
  AdaptivePlanProposal,
  PlanDependency,
  PlanTask,
  ScheduleAssignment,
} from './adaptive-types.js';

export type CommitIssueCode =
  | 'INVALID_PROPOSAL'
  | 'INFEASIBLE_PROPOSAL'
  | 'UNKNOWN_TASK'
  | 'STALE_TASK_VERSION'
  | 'OVERLAPPING_ASSIGNMENTS'
  | 'DEADLINE_MISSED'
  | 'DEPENDENCY_ORDER';

export interface CommitValidationIssue {
  code: CommitIssueCode;
  taskIds: string[];
  message: string;
}

export type CommitValidationResult =
  | { success: true; proposal: AdaptivePlanProposal }
  | { success: false; issues: CommitValidationIssue[] };

function isAssignment(value: unknown): value is ScheduleAssignment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.taskId === 'string' &&
    Number.isInteger(item.taskVersion) &&
    typeof item.start === 'string' && Number.isFinite(Date.parse(item.start)) &&
    typeof item.end === 'string' && Number.isFinite(Date.parse(item.end)) &&
    Date.parse(item.start) < Date.parse(item.end) &&
    Array.isArray(item.reasonCodes) &&
    typeof item.explanation === 'string' && item.explanation.trim().length > 0;
}

export function isAdaptivePlanProposal(value: unknown): value is AdaptivePlanProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.kind === 'adaptive-schedule' &&
    item.schemaVersion === 1 &&
    (item.status === 'ready' || item.status === 'infeasible') &&
    Array.isArray(item.assignments) && item.assignments.every(isAssignment) &&
    Array.isArray(item.deferredTaskIds) && item.deferredTaskIds.every((id) => typeof id === 'string') &&
    Array.isArray(item.violations) &&
    item.metrics !== null && typeof item.metrics === 'object' &&
    typeof item.explanation === 'string';
}

export function validateAdaptivePlanForCommit(
  value: unknown,
  tasks: readonly PlanTask[],
  dependencies: readonly PlanDependency[],
): CommitValidationResult {
  if (!isAdaptivePlanProposal(value)) {
    return { success: false, issues: [{
      code: 'INVALID_PROPOSAL', taskIds: [], message: '计划提案结构无效。',
    }] };
  }
  if (value.status !== 'ready') {
    return { success: false, issues: [{
      code: 'INFEASIBLE_PROPOSAL', taskIds: [], message: '不可行方案不能执行。',
    }] };
  }
  const issues: CommitValidationIssue[] = [];
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const assignmentByTask = new Map<string, ScheduleAssignment>();
  const sorted = [...value.assignments].sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
  for (const assignment of sorted) {
    const task = taskById.get(assignment.taskId);
    if (!task) {
      issues.push({ code: 'UNKNOWN_TASK', taskIds: [assignment.taskId], message: '任务已不存在。' });
      continue;
    }
    if (assignmentByTask.has(assignment.taskId) || task.version !== assignment.taskVersion) {
      issues.push({
        code: 'STALE_TASK_VERSION', taskIds: [assignment.taskId],
        message: `“${task.title}”已变化，请重新生成计划。`,
      });
    }
    if (task.deadline && Date.parse(assignment.end) > Date.parse(task.deadline)) {
      issues.push({
        code: 'DEADLINE_MISSED', taskIds: [task.id], message: `“${task.title}”超过截止时间。`,
      });
    }
    assignmentByTask.set(assignment.taskId, assignment);
  }
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous && current && Date.parse(current.start) < Date.parse(previous.end)) {
      issues.push({
        code: 'OVERLAPPING_ASSIGNMENTS', taskIds: [previous.taskId, current.taskId],
        message: '计划中存在重叠任务。',
      });
    }
  }
  for (const edge of dependencies) {
    const successor = assignmentByTask.get(edge.successorId);
    if (!successor) continue;
    const predecessorTask = taskById.get(edge.predecessorId);
    const predecessor = assignmentByTask.get(edge.predecessorId);
    if (predecessorTask?.status !== 'completed' &&
      (!predecessor || Date.parse(predecessor.end) > Date.parse(successor.start))) {
      issues.push({
        code: 'DEPENDENCY_ORDER', taskIds: [edge.predecessorId, edge.successorId],
        message: '前置任务尚未在后置任务开始前完成。',
      });
    }
  }
  return issues.length === 0 ? { success: true, proposal: value } : { success: false, issues };
}
