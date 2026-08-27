import type { PlanReasonCode, PlanTask } from './adaptive-types.js';

export interface RankableTask {
  task: PlanTask;
  durationMinutes: number;
  hasDependency: boolean;
  previousStart: number | null;
  effectiveDeadline: number;
}

function compareNumber(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareRankableTasks(
  left: RankableTask,
  right: RankableTask,
  cursor: number,
): number {
  const leftDeadline = left.effectiveDeadline;
  const rightDeadline = right.effectiveDeadline;
  const deadlineOrder = compareNumber(leftDeadline, rightDeadline);
  if (deadlineOrder !== 0) return deadlineOrder;

  const leftPrevious = left.previousStart ?? Number.POSITIVE_INFINITY;
  const rightPrevious = right.previousStart ?? Number.POSITIVE_INFINITY;
  const previousOrder = compareNumber(
    Math.abs(leftPrevious - cursor),
    Math.abs(rightPrevious - cursor),
  );
  if (previousOrder !== 0) return previousOrder;

  const goalOrder = Number(right.task.goalId !== null) - Number(left.task.goalId !== null);
  if (goalOrder !== 0) return goalOrder;

  const userOrder = compareNumber(left.task.rank, right.task.rank);
  if (userOrder !== 0) return userOrder;

  const fitOrder = compareNumber(left.durationMinutes, right.durationMinutes);
  if (fitOrder !== 0) return fitOrder;
  return left.task.id.localeCompare(right.task.id);
}

export function reasonsForTask(
  candidate: RankableTask,
  cursor: number,
  calibrationFactor: number,
): { codes: PlanReasonCode[]; explanation: string } {
  const codes: PlanReasonCode[] = [];
  const phrases: string[] = [];
  const deadline = candidate.effectiveDeadline;
  if (Number.isFinite(deadline)) {
    codes.push('DEADLINE_AT_RISK');
    const hours = Math.max(0, Math.round((deadline - cursor) / 3_600_000));
    phrases.push(`距本任务或后续任务的有效截止约 ${hours} 小时`);
  }
  if (candidate.hasDependency) {
    codes.push('DEPENDENCY_READY');
    phrases.push('前置任务已完成或已排在此前');
  }
  if (candidate.previousStart !== null) {
    codes.push('PREVIOUS_PLAN_PRESERVED');
    phrases.push('优先保持原计划次序');
  }
  if (candidate.task.goalId !== null) {
    codes.push('GOAL_ALIGNED');
    phrases.push('已关联长期目标');
  }
  codes.push('USER_ORDER', 'FITS_WINDOW');
  phrases.push(`遵循人工次序并适配 ${candidate.durationMinutes} 分钟时间块`);
  if (calibrationFactor !== 1) {
    codes.push('ESTIMATE_CALIBRATED');
    phrases.push(`依据历史耗时校准 ×${calibrationFactor}`);
  }
  return { codes, explanation: phrases.join('；') };
}
