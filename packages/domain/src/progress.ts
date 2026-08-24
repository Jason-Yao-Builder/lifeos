import { TaskProgressSchema, type TaskProgress, type TaskStatus } from '@lifeos/contracts';

export interface SubtaskProgressItem {
  status: TaskStatus;
}

export function calculateSubtaskProgress(
  subtasks: readonly SubtaskProgressItem[],
): TaskProgress {
  const total = subtasks.length;
  const completed = subtasks.filter((task) => task.status === 'completed').length;
  return TaskProgressSchema.parse({
    completed,
    total,
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  });
}
