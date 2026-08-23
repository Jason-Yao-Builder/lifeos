import { LocalDateSchema, type LocalDate, type TaskStatus } from '@lifeos/contracts';

export interface TodaySelectableTask {
  status: TaskStatus;
  plannedDate: LocalDate | null;
  deadline: string | null;
  deletedAt: string | null;
}

export interface TodaySelectionOptions {
  today: LocalDate;
  timeZone?: string;
}

const ACTIVE_STATUSES: ReadonlySet<TaskStatus> = new Set(['todo', 'in_progress']);

export function dateTimeToLocalDate(value: string, timeZone = 'Asia/Shanghai'): LocalDate {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid date-time: ${value}`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return LocalDateSchema.parse(`${get('year')}-${get('month')}-${get('day')}`);
}

export function isTaskForToday(
  task: TodaySelectableTask,
  options: TodaySelectionOptions,
): boolean {
  const today = LocalDateSchema.parse(options.today);
  if (task.deletedAt !== null || !ACTIVE_STATUSES.has(task.status)) return false;
  if (task.plannedDate === today) return true;
  if (task.deadline === null) return false;
  return dateTimeToLocalDate(task.deadline, options.timeZone) <= today;
}

export function selectTodayTasks<T extends TodaySelectableTask>(
  tasks: readonly T[],
  options: TodaySelectionOptions,
): T[] {
  return tasks.filter((task) => isTaskForToday(task, options));
}
