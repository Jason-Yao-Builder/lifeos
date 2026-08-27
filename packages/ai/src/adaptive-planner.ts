import { hasDependencyCycle } from '@lifeos/domain';
import { calibratedDurationMinutes, durationCalibrationFactor } from './duration-model.js';
import { calculateAdaptivePlanMetrics } from './adaptive-metrics.js';
import { compareRankableTasks, reasonsForTask, type RankableTask } from './adaptive-ranking.js';
import type {
  AdaptivePlanProposal,
  AdaptivePlanRequest,
  AvailabilityWindow,
  PlanTask,
  PlanViolation,
  ScheduleAssignment,
} from './adaptive-types.js';

interface ParsedWindow extends AvailabilityWindow {
  startMs: number;
  endMs: number;
}

const isActive = (task: PlanTask): boolean =>
  task.deletedAt === null && ['todo', 'in_progress'].includes(task.status);

function parseWindows(windows: readonly AvailabilityWindow[], violations: PlanViolation[]): ParsedWindow[] {
  const parsed = windows.flatMap((window) => {
    const startMs = Date.parse(window.start);
    const endMs = Date.parse(window.end);
    if (!window.id || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
      violations.push({
        code: 'INVALID_WINDOW',
        severity: 'error',
        taskIds: [],
        message: `时间窗口 ${window.id || '未命名'} 无效。`,
      });
      return [];
    }
    return [{ ...window, startMs, endMs }];
  }).sort((left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id));
  for (let index = 1; index < parsed.length; index += 1) {
    const previous = parsed[index - 1];
    const current = parsed[index];
    if (previous && current && current.startMs < previous.endMs) {
      violations.push({
        code: 'OVERLAPPING_WINDOWS',
        severity: 'error',
        taskIds: [],
        message: `时间窗口 ${previous.id} 与 ${current.id} 重叠。`,
      });
    }
  }
  return parsed;
}

function requestViolations(request: AdaptivePlanRequest): {
  violations: PlanViolation[];
  windows: ParsedWindow[];
} {
  const violations: PlanViolation[] = [];
  if (!Number.isFinite(Date.parse(request.now))) {
    violations.push({ code: 'INVALID_NOW', severity: 'error', taskIds: [], message: 'now 必须是有效时间。' });
  }
  if (request.freezeBefore !== undefined && !Number.isFinite(Date.parse(request.freezeBefore))) {
    violations.push({
      code: 'INVALID_LOCKED_ASSIGNMENT', severity: 'error', taskIds: [],
      message: 'freezeBefore 必须是有效时间。',
    });
  }
  const ids = request.tasks.map((task) => task.id);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length > 0) {
    violations.push({
      code: 'DUPLICATE_TASK', severity: 'error', taskIds: duplicates, message: '任务 ID 不能重复。',
    });
  }
  const taskIds = new Set(ids);
  const missing = [...new Set(request.dependencies.flatMap((edge) =>
    [edge.predecessorId, edge.successorId].filter((id) => !taskIds.has(id)),
  ))];
  if (missing.length > 0) {
    violations.push({
      code: 'MISSING_DEPENDENCY_TASK', severity: 'error', taskIds: missing,
      message: '依赖关系引用了不在任务快照中的任务。',
    });
  }
  if (hasDependencyCycle(request.dependencies)) {
    violations.push({
      code: 'DEPENDENCY_CYCLE', severity: 'error', taskIds: [], message: '依赖关系存在循环。',
    });
  }
  return { violations, windows: parseWindows(request.windows, violations) };
}

function emptyProposal(
  request: AdaptivePlanRequest,
  windows: readonly ParsedWindow[],
  violations: PlanViolation[],
  factor: number,
): AdaptivePlanProposal {
  const allowed = new Set(request.allowedTaskIds ?? request.tasks.map((task) => task.id));
  const activeTasks = request.tasks.filter((task) => isActive(task) && allowed.has(task.id));
  const capacityMinutes = windows.reduce((total, item) => total + (item.endMs - item.startMs) / 60_000, 0);
  const horizonEnd = windows.at(-1)?.endMs ?? Date.parse(request.now);
  return {
    kind: 'adaptive-schedule', schemaVersion: 1, generatedAt: request.now, status: 'infeasible',
    assignments: [], deferredTaskIds: activeTasks.map((task) => task.id), violations,
    metrics: calculateAdaptivePlanMetrics({
      activeTasks, assignments: [], dependencies: request.dependencies,
      previousAssignments: request.previousAssignments ?? [], capacityMinutes, calibrationFactor: factor,
      horizonEnd,
    }),
    explanation: '输入未通过确定性校验，未生成任何变更。',
  };
}

export function compileAdaptivePlan(request: AdaptivePlanRequest): AdaptivePlanProposal {
  const factor = durationCalibrationFactor(request.durationHistory);
  const checked = requestViolations(request);
  if (checked.violations.some((item) => item.severity === 'error')) {
    return emptyProposal(request, checked.windows, checked.violations, factor);
  }

  const allowed = new Set(request.allowedTaskIds ?? request.tasks.map((task) => task.id));
  const activeTasks = request.tasks.filter((task) => isActive(task) && allowed.has(task.id));
  const activeIds = new Set(activeTasks.map((task) => task.id));
  const completedIds = new Set(
    request.tasks.filter((task) => task.status === 'completed').map((task) => task.id),
  );
  const predecessors = new Map<string, string[]>();
  for (const edge of request.dependencies) {
    const current = predecessors.get(edge.successorId) ?? [];
    current.push(edge.predecessorId);
    predecessors.set(edge.successorId, current);
  }
  const previousByTask = new Map(
    (request.previousAssignments ?? []).map((item) => [item.taskId, Date.parse(item.start)]),
  );
  const durations = new Map(activeTasks.map((task) => [
    task.id,
    calibratedDurationMinutes(task.estimatedMinutes, factor, request.defaultEstimatedMinutes),
  ]));
  const effectiveDeadlines = new Map(activeTasks.map((task) => {
    const parsed = task.deadline ? Date.parse(task.deadline) : Number.POSITIVE_INFINITY;
    return [task.id, Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY];
  }));
  for (let pass = 0; pass < activeTasks.length; pass += 1) {
    let changed = false;
    for (const edge of request.dependencies) {
      if (!activeIds.has(edge.predecessorId) || !activeIds.has(edge.successorId)) continue;
      const successorDeadline = effectiveDeadlines.get(edge.successorId) ?? Number.POSITIVE_INFINITY;
      const successorDuration = durations.get(edge.successorId) ?? 30;
      const requiredBy = successorDeadline - successorDuration * 60_000;
      const current = effectiveDeadlines.get(edge.predecessorId) ?? Number.POSITIVE_INFINITY;
      if (requiredBy < current) {
        effectiveDeadlines.set(edge.predecessorId, requiredBy);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const assignments: ScheduleAssignment[] = [];
  const assignedEnd = new Map<string, number>();
  const lockedByWindow = new Map<string, Array<{ start: number; end: number }>>();
  const lockViolations: PlanViolation[] = [];
  const freezeBefore = request.freezeBefore ? Date.parse(request.freezeBefore) : Number.NEGATIVE_INFINITY;
  const activeById = new Map(activeTasks.map((task) => [task.id, task]));
  for (const previous of request.previousAssignments ?? []) {
    const start = Date.parse(previous.start);
    const end = Date.parse(previous.end);
    const task = activeById.get(previous.taskId);
    if (!task || start >= freezeBefore) continue;
    const window = checked.windows.find((item) => start >= item.startMs && end <= item.endMs);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || !window || assignedEnd.has(task.id)) {
      lockViolations.push({
        code: 'INVALID_LOCKED_ASSIGNMENT', severity: 'error', taskIds: [task.id],
        message: `“${task.title}”的冻结时间块无效或重复。`,
      });
      continue;
    }
    const intervals = lockedByWindow.get(window.id) ?? [];
    intervals.push({ start, end });
    lockedByWindow.set(window.id, intervals);
    assignments.push({
      taskId: task.id, taskVersion: task.version, windowId: window.id,
      start: new Date(start).toISOString(), end: new Date(end).toISOString(),
      durationMinutes: (end - start) / 60_000,
      reasonCodes: ['PREVIOUS_PLAN_PRESERVED', 'USER_ORDER', 'FITS_WINDOW'],
      explanation: '处于冻结时域内，保持用户已经承诺的时间块。',
    });
    assignedEnd.set(task.id, end);
  }
  for (const [windowId, intervals] of lockedByWindow) {
    intervals.sort((left, right) => left.start - right.start);
    for (let index = 1; index < intervals.length; index += 1) {
      const previous = intervals[index - 1];
      const current = intervals[index];
      if (previous && current && current.start < previous.end) {
        lockViolations.push({
          code: 'LOCKED_ASSIGNMENT_CONFLICT', severity: 'error', taskIds: [],
          message: `时间窗口 ${windowId} 内的冻结任务互相重叠。`,
        });
      }
    }
  }
  if (lockViolations.length > 0) {
    return emptyProposal(request, checked.windows, [...checked.violations, ...lockViolations], factor);
  }

  const scheduleRange = (windowId: string, rangeStart: number, rangeEnd: number): void => {
    let cursor = Math.max(rangeStart, Date.parse(request.now));
    while (cursor < rangeEnd) {
      const candidates = activeTasks.flatMap((task): RankableTask[] => {
        if (assignedEnd.has(task.id)) return [];
        const required = predecessors.get(task.id) ?? [];
        const permanentlyBlocked = required.some((id) =>
          !completedIds.has(id) && !activeIds.has(id),
        );
        if (permanentlyBlocked) return [];
        const ready = required.every((id) =>
          completedIds.has(id) || (assignedEnd.get(id) ?? Number.POSITIVE_INFINITY) <= cursor,
        );
        const durationMinutes = durations.get(task.id) ?? 30;
        if (!ready || cursor + durationMinutes * 60_000 > rangeEnd) return [];
        return [{
          task,
          durationMinutes,
          hasDependency: required.length > 0,
          previousStart: previousByTask.get(task.id) ?? null,
          effectiveDeadline: effectiveDeadlines.get(task.id) ?? Number.POSITIVE_INFINITY,
        }];
      });
      candidates.sort((left, right) => compareRankableTasks(left, right, cursor));
      const selected = candidates[0];
      if (!selected) break;
      const end = cursor + selected.durationMinutes * 60_000;
      const reasons = reasonsForTask(selected, cursor, factor);
      assignments.push({
        taskId: selected.task.id,
        taskVersion: selected.task.version,
        windowId,
        start: new Date(cursor).toISOString(),
        end: new Date(end).toISOString(),
        durationMinutes: selected.durationMinutes,
        reasonCodes: reasons.codes,
        explanation: reasons.explanation,
      });
      assignedEnd.set(selected.task.id, end);
      cursor = end;
    }
  };

  for (const window of checked.windows) {
    let cursor = window.startMs;
    for (const locked of lockedByWindow.get(window.id) ?? []) {
      scheduleRange(window.id, cursor, locked.start);
      cursor = locked.end;
    }
    scheduleRange(window.id, cursor, window.endMs);
  }
  assignments.sort((left, right) => Date.parse(left.start) - Date.parse(right.start));

  const deferredTaskIds = activeTasks
    .filter((task) => !assignedEnd.has(task.id))
    .map((task) => task.id);
  const violations = [...checked.violations];
  const horizonEnd = checked.windows.at(-1)?.endMs ?? Date.parse(request.now);
  const assignmentByTask = new Map(assignments.map((item) => [item.taskId, item]));
  for (const edge of request.dependencies) {
    const successor = assignmentByTask.get(edge.successorId);
    if (!successor || completedIds.has(edge.predecessorId)) continue;
    const predecessor = assignmentByTask.get(edge.predecessorId);
    if (!predecessor || Date.parse(predecessor.end) > Date.parse(successor.start)) {
      violations.push({
        code: 'DEPENDENCY_BLOCKED', severity: 'error',
        taskIds: [edge.predecessorId, edge.successorId],
        message: '冻结或新排时间块破坏了前后置任务顺序。',
      });
    }
  }
  for (const task of activeTasks) {
    const deadline = task.deadline ? Date.parse(task.deadline) : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(deadline) || deadline > horizonEnd) continue;
    const end = assignedEnd.get(task.id);
    if (end === undefined || end > deadline) {
      violations.push({
        code: 'DEADLINE_MISSED', severity: 'error', taskIds: [task.id],
        message: `“${task.title}”无法在截止时间前完成。`,
      });
    }
  }
  for (const taskId of deferredTaskIds) {
    const unfinished = (predecessors.get(taskId) ?? []).filter((id) =>
      !completedIds.has(id) && !assignedEnd.has(id),
    );
    if (unfinished.length > 0) {
      violations.push({
        code: 'DEPENDENCY_BLOCKED', severity: 'warning', taskIds: [taskId, ...unfinished],
        message: `任务 ${taskId} 仍被未安排的前置任务阻塞。`,
      });
    }
  }
  const capacityMinutes = checked.windows.reduce(
    (total, item) => total + (item.endMs - item.startMs) / 60_000,
    0,
  );
  const status = violations.some((item) => item.severity === 'error') ? 'infeasible' : 'ready';
  return {
    kind: 'adaptive-schedule', schemaVersion: 1, generatedAt: request.now, status,
    assignments, deferredTaskIds, violations,
    metrics: calculateAdaptivePlanMetrics({
      activeTasks, assignments, dependencies: request.dependencies,
      previousAssignments: request.previousAssignments ?? [], capacityMinutes,
      calibrationFactor: factor, horizonEnd,
    }),
    explanation: status === 'ready'
      ? `已在硬约束内安排 ${assignments.length} 项；其余任务保留为待安排，不写回数据库。`
      : '当前容量或依赖无法满足全部硬截止；方案仅供修正，不可直接执行。',
  };
}
