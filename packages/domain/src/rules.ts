import type { RuleProposal, TaskRecord, TaskStatus } from '@lifeos/contracts';
import { dateTimeToLocalDate } from './today.js';

export interface PresetRuleContext {
  now: string;
  timeZone?: string;
  deadlineDays?: number;
  staleDays?: number;
}

type RuleTask = Pick<
  TaskRecord,
  'id' | 'title' | 'status' | 'temperature' | 'deadline' | 'updatedAt' | 'deletedAt'
>;

const ACTIVE_STATUSES: ReadonlySet<TaskStatus> = new Set(['todo', 'in_progress']);
const DAY_MS = 86_400_000;

function dayNumber(localDate: string): number {
  return Date.parse(`${localDate}T00:00:00Z`) / DAY_MS;
}

function validateDayThreshold(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`);
}

function proposalKey(ruleId: RuleProposal['ruleId'], taskId: string, date: string): string {
  return `${ruleId}:${taskId}:${date}`;
}

export function evaluatePresetRules(
  tasks: readonly RuleTask[],
  context: PresetRuleContext,
): RuleProposal[] {
  const timeZone = context.timeZone ?? 'Asia/Shanghai';
  const deadlineDays = context.deadlineDays ?? 3;
  const staleDays = context.staleDays ?? 7;
  validateDayThreshold('deadlineDays', deadlineDays);
  validateDayThreshold('staleDays', staleDays);

  const today = dateTimeToLocalDate(context.now, timeZone);
  const todayNumber = dayNumber(today);
  const friday = new Date(todayNumber * DAY_MS).getUTCDay() === 5;
  const proposals: RuleProposal[] = [];

  for (const task of tasks) {
    if (task.deletedAt !== null || !ACTIVE_STATUSES.has(task.status)) continue;

    const deadlineDate = task.deadline ? dateTimeToLocalDate(task.deadline, timeZone) : null;
    const daysUntilDeadline = deadlineDate ? dayNumber(deadlineDate) - todayNumber : null;
    const deadlineClose = daysUntilDeadline !== null && daysUntilDeadline <= deadlineDays;

    if (deadlineClose && task.temperature !== 'hot') {
      const ruleId = 'deadline-auto-heat' as const;
      proposals.push({
        ruleId,
        taskId: task.id,
        effectiveDate: today,
        idempotencyKey: proposalKey(ruleId, task.id, today),
        reason: `Deadline is within ${deadlineDays} days or overdue`,
        action: { type: 'change_temperature', value: 'hot', requireConfirmation: false },
      });
    }

    const lastUpdated = dateTimeToLocalDate(task.updatedAt, timeZone);
    const staleForDays = todayNumber - dayNumber(lastUpdated);
    if ((task.temperature === 'hot' || task.temperature === 'warm') && staleForDays >= staleDays) {
      const ruleId = 'stale-task-observation' as const;
      proposals.push({
        ruleId,
        taskId: task.id,
        effectiveDate: today,
        idempotencyKey: proposalKey(ruleId, task.id, today),
        reason: `Task has not changed for ${staleForDays} days`,
        action: {
          type: 'create_card',
          cardType: 'observation',
          title: `Task stalled: ${task.title}`,
          body: `This task has not changed for ${staleForDays} days. Keep, split, or cool it down?`,
          requireConfirmation: false,
        },
      });
    }

    if (friday && task.temperature === 'hot' && !deadlineClose) {
      const ruleId = 'friday-hot-demotion' as const;
      proposals.push({
        ruleId,
        taskId: task.id,
        effectiveDate: today,
        idempotencyKey: proposalKey(ruleId, task.id, today),
        reason: 'Incomplete hot task reached the Friday review',
        action: { type: 'change_temperature', value: 'warm', requireConfirmation: true },
      });
    }
  }

  return proposals;
}
