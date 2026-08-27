import type {
  RepeatTemplate,
  Task,
  TaskDependency,
  TaskEvent,
  TaskProgress,
  UpdateTask,
} from "../../types";
import { hierarchyDepth } from "../../v02-utils";

const hiddenTaskHistoryFields = new Set(["temperature", "score", "scoreDimensions"]);

export interface TaskHistoryBatch {
  id: string;
  type: string;
  actor: TaskEvent["actor"];
  createdAt: string;
  events: TaskEvent[];
  totalCount: number;
}

function taskHistoryValueText(value: unknown): string {
  if (value === null || value === undefined) return "未设置";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function taskHistoryBatchId(event: TaskEvent): string {
  return event.batchId ?? event.id.replace(/:\d+$/, "");
}

export function taskHistoryEventType(event: TaskEvent): string {
  if (event.type) return event.type;
  const prefix = event.summary.split(":", 1)[0]?.trim();
  return prefix?.startsWith("task.") ? prefix : "task.changed";
}

export function taskHistoryEventMatches(event: TaskEvent, rawQuery: string): boolean {
  const query = rawQuery.trim().toLocaleLowerCase("zh-CN");
  if (!query) return true;
  if (query.startsWith("key:")) {
    const key = query.slice(4).trim();
    return Boolean(key) && event.field.toLocaleLowerCase("zh-CN").includes(key);
  }
  return [
    event.field,
    event.summary,
    taskHistoryValueText(event.oldValue),
    taskHistoryValueText(event.newValue),
  ].some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
}

export function projectTaskHistory(
  events: readonly TaskEvent[],
  query = "",
): TaskHistoryBatch[] {
  const batches = new Map<string, TaskHistoryBatch>();
  for (const event of events) {
    if (hiddenTaskHistoryFields.has(event.field)) continue;
    const id = taskHistoryBatchId(event);
    const batch = batches.get(id) ?? {
      id,
      type: taskHistoryEventType(event),
      actor: event.actor,
      createdAt: event.createdAt,
      events: [],
      totalCount: 0,
    };
    batch.totalCount += 1;
    if (taskHistoryEventMatches(event, query)) batch.events.push(event);
    batches.set(id, batch);
  }
  return [...batches.values()].filter((batch) => batch.events.length > 0);
}

export function taskHistoryBatchTitle(type: string): string {
  const labels: Record<string, string> = {
    "task.created": "创建任务",
    "task.updated": "保存更改",
    "task.reordered": "调整顺序",
    "task.deleted": "归档任务",
    "task.image.added": "添加图片",
    "task.image.deleted": "删除图片",
  };
  return labels[type] ?? "任务变更";
}

export function createTaskDraft(task: Task | null): UpdateTask {
  return task
    ? {
        title: task.title,
        description: task.description,
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

export function taskAncestorChain(task: Task, allTasks: readonly Task[]): Task[] {
  const byId = new Map(allTasks.map((candidate) => [candidate.id, candidate]));
  const visited = new Set([task.id]);
  const chain: Task[] = [];
  let parentId = task.parentTaskId ?? null;
  while (parentId && !visited.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    chain.push(parent);
    visited.add(parent.id);
    parentId = parent.parentTaskId ?? null;
  }
  return chain.reverse();
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
  ancestorTasks: Task[];
  incomingDependencies: TaskDependency[];
  outgoingDependencies: TaskDependency[];
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
    ancestorTasks: taskAncestorChain(input.task, input.allTasks),
    incomingDependencies: input.dependencies.filter(
      (item) => item.successorId === input.task.id,
    ),
    outgoingDependencies: input.dependencies.filter(
      (item) => item.predecessorId === input.task.id,
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
