import type {
  RepeatTemplate,
  Task,
  TaskDependency,
  TaskProgress,
  UpdateTask,
} from "../../types";
import { hierarchyDepth } from "../../v02-utils";

export function createTaskDraft(task: Task | null): UpdateTask {
  return task
    ? {
        title: task.title,
        description: task.description,
        temperature: task.temperature,
        status: task.status,
        deadline: task.deadline?.slice(0, 10) ?? null,
        plannedDate: task.plannedDate?.slice(0, 10) ?? null,
        goalId: task.goalId ?? null,
        groupId: task.groupId ?? null,
        tags: [...task.tags],
      }
    : {};
}

export function taskParent(task: Task | null, allTasks: readonly Task[]): Task | null {
  if (!task?.parentTaskId) return null;
  return allTasks.find((candidate) => candidate.id === task.parentTaskId) ?? null;
}

export function knownDirectSubtasks(parentId: string, tasks: readonly Task[]): Task[] {
  return tasks
    .filter((task) => task.parentTaskId === parentId)
    .sort((left, right) => left.rank - right.rank);
}

export function subtasksAfterLoad(
  current: readonly Task[],
  result: PromiseSettledResult<Task[]>,
): Task[] {
  return result.status === "fulfilled" ? result.value : [...current];
}

export interface TaskStructureProjectionInput {
  task: Task;
  allTasks: readonly Task[];
  subtasks: readonly Task[];
  dependencies: readonly TaskDependency[];
  templates: readonly RepeatTemplate[];
  progress: TaskProgress;
  subtaskLoadState: "loading" | "ready" | "error";
  reordering: boolean;
}

export interface TaskStructureViewModel {
  depth: number;
  parentTask: Task | null;
  incomingDependencies: TaskDependency[];
  relatedTemplate: RepeatTemplate | null;
  canReorderSubtasks: boolean;
  canCreateSubtask: boolean;
  progressPercent: number;
}

export function projectTaskStructure(
  input: TaskStructureProjectionInput,
): TaskStructureViewModel {
  const depth = hierarchyDepth(input.task, [...input.allTasks]);
  return {
    depth,
    parentTask: taskParent(input.task, input.allTasks),
    incomingDependencies: input.dependencies.filter(
      (item) => item.successorId === input.task.id,
    ),
    relatedTemplate: input.templates.find(
      (item) => item.id === input.task.repeatTemplateId,
    ) ?? null,
    canReorderSubtasks: input.subtasks.length > 1
      && input.subtaskLoadState !== "loading"
      && !input.reordering,
    canCreateSubtask: depth < 3,
    progressPercent: Math.max(0, Math.min(100, input.progress.percent)),
  };
}

export function drawerError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}
