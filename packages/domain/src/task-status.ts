import type { TaskRecord, TaskStatus } from '@lifeos/contracts';
import { InvalidTransitionError } from './errors.js';

export const TASK_STATUS_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  todo: ['in_progress'],
  in_progress: ['completed', 'abandoned'],
  completed: ['todo', 'archived'],
  abandoned: ['archived'],
  archived: ['todo'],
};

export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_STATUS_TRANSITIONS[from].includes(to);
}

export function transitionTaskStatus<T extends TaskRecord>(
  task: T,
  to: TaskStatus,
  at: string,
): T {
  if (!canTransitionTaskStatus(task.status, to)) {
    throw new InvalidTransitionError('task', task.status, to);
  }

  return {
    ...task,
    status: to,
    completedAt: to === 'completed' ? at : to === 'todo' ? null : task.completedAt,
    updatedAt: at,
    version: task.version + 1,
  };
}
