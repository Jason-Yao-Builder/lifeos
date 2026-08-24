import type { Task, TaskGroup, TaskScoreDimensions } from "../../types";
import type { TaskCompletionMotion, TaskBoardProps, TaskFilters } from "./contracts";
import type { TaskQueueGroupKey, TaskTreeRow } from "../../v02-utils";
import {
  matchesTagKeyword,
  matchesTaskTimeFilter,
  taskQueueGroup,
  taskRowsByRank,
  taskTreeRows,
  visibleTaskTreeRows,
} from "../../v02-utils";
import {
  clampScoreDimension,
  mergeTags,
  todayKey,
} from "../../utils";

export const defaultScoreDimensions: TaskScoreDimensions = {
  impact: 50,
  urgency: 50,
  alignment: 50,
  effort: 50,
};

export const scoreDimensionFields: ReadonlyArray<{
  key: keyof TaskScoreDimensions;
  label: string;
  hint: string;
}> = [
  { key: "impact", label: "影响力", hint: "对结果的影响" },
  { key: "urgency", label: "紧迫度", hint: "时间压力" },
  { key: "alignment", label: "方向一致性", hint: "与长期方向一致" },
  { key: "effort", label: "精力成本", hint: "仅作元数据，不参与评分" },
];

export type ScoreDimensionDraft = {
  [Key in keyof TaskScoreDimensions]: number | "";
};

export function sameScoreDimensions(
  left: TaskScoreDimensions | null | undefined,
  right: TaskScoreDimensions,
): boolean {
  return Boolean(left) && scoreDimensionFields.every(({ key }) => left?.[key] === right[key]);
}

export function createScoreDimensionDraft(
  dimensions: TaskScoreDimensions,
): ScoreDimensionDraft {
  return { ...dimensions };
}

export function createScoreEditorState(
  taskDimensions: TaskScoreDimensions | null | undefined,
  parentDimensions: TaskScoreDimensions | null | undefined,
): { draft: ScoreDimensionDraft; inheritsParent: boolean } {
  const inheritsParent = parentDimensions !== null && parentDimensions !== undefined && (
    !taskDimensions || sameScoreDimensions(taskDimensions, parentDimensions)
  );
  const dimensions = inheritsParent && parentDimensions
    ? parentDimensions
    : taskDimensions ?? defaultScoreDimensions;
  return { draft: createScoreDimensionDraft(dimensions), inheritsParent };
}

export function claimParentInheritance(
  parentTaskId: string | null | undefined,
  pending: { current: boolean },
): boolean {
  if (!parentTaskId || pending.current) return false;
  pending.current = true;
  return true;
}

export function parseScoreDimensionDraftValue(
  rawValue: string,
  valueAsNumber: number,
): number | "" {
  return rawValue === "" ? "" : clampScoreDimension(valueAsNumber);
}

export function normalizeScoreDimensionDraft(
  draft: ScoreDimensionDraft,
): TaskScoreDimensions | null {
  if (
    draft.impact === "" ||
    draft.urgency === "" ||
    draft.alignment === "" ||
    draft.effort === ""
  ) return null;
  return {
    impact: draft.impact,
    urgency: draft.urgency,
    alignment: draft.alignment,
    effort: draft.effort,
  };
}

export interface QuickAddDraft {
  title: string;
  description: string;
  temperature: Task["temperature"];
  deadline: string;
  groupId: string;
  tags: string[];
  tagInput: string;
  manualScore: boolean;
  scoreDimensions: TaskScoreDimensions;
}

export function buildQuickTaskInput(
  view: TaskBoardProps["view"],
  draft: QuickAddDraft,
): Parameters<TaskBoardProps["onAdd"]>[0] {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    temperature: draft.temperature,
    deadline: draft.deadline || null,
    plannedDate: view === "today" ? todayKey() : null,
    groupId: draft.groupId || null,
    tags: mergeTags(draft.tags, draft.tagInput),
    ...(draft.manualScore ? { scoreDimensions: draft.scoreDimensions } : {}),
  };
}

export const taskGroupColorPresets = [
  "#2F6B52",
  "#4D7C8A",
  "#9A6A3A",
  "#7A5FA3",
  "#B04A5A",
  "#526D9B",
] as const;

export function normalizeTaskGroupColor(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : null;
}

export function buildTaskGroupUpdatePatch(
  nameDraft: string,
  colorDraft: string,
): Pick<TaskGroup, "name" | "color"> | null {
  const name = nameDraft.trim();
  const color = normalizeTaskGroupColor(colorDraft);
  return name && color ? { name, color } : null;
}

export const taskCompletionMotionDurations: Record<TaskCompletionMotion, number> = {
  exiting: 520,
  entering: 360,
  restoring: 240,
};

export function taskCompletionMotionDuration(
  motion: TaskCompletionMotion,
  reducedMotion: boolean,
): number {
  return reducedMotion ? 0 : taskCompletionMotionDurations[motion];
}

export function matchesTaskGroupFilter(task: Task, group: TaskFilters["group"]): boolean {
  if (group === "all") return true;
  if (group === "ungrouped") return !task.groupId;
  return task.groupId === group;
}

export const queueGroups: ReadonlyArray<{ key: TaskQueueGroupKey; label: string }> = [
  { key: "overdue", label: "已逾期" },
  { key: "due_today", label: "今日截止" },
  { key: "future", label: "未来截止" },
  { key: "unscheduled", label: "无截止安排" },
  { key: "completed_today", label: "今日已完成" },
  { key: "completed_past", label: "历史完成" },
  { key: "other_terminal", label: "其他终态" },
];

export interface TaskQueueSection {
  key: TaskQueueGroupKey;
  label: string;
  allRows: TaskTreeRow[];
  rows: TaskTreeRow[];
  hiddenByParent: number;
}

export interface TaskBoardProjection {
  orderedRows: TaskTreeRow[];
  matchedRows: TaskTreeRow[];
  visibleRows: TaskTreeRow[];
  queueSections: TaskQueueSection[];
  renderedRows: TaskTreeRow[];
  reorderScopeIds: string[];
  visibleTasks: Task[];
  filterActive: boolean;
  canReorder: boolean;
  completed: number;
  completion: number;
  completionAnnouncement: string;
}

export interface ProjectTaskBoardInput {
  view: TaskBoardProps["view"];
  tasks: Task[];
  filters: TaskFilters;
  currentDate: string;
  collapsedTaskIds: ReadonlySet<string>;
  collapsedQueues: ReadonlySet<TaskQueueGroupKey>;
  completionMotions: Readonly<Partial<Record<string, TaskCompletionMotion>>>;
}

export function projectTaskBoard(input: ProjectTaskBoardInput): TaskBoardProjection {
  const {
    view,
    tasks,
    filters,
    currentDate,
    collapsedTaskIds,
    collapsedQueues,
    completionMotions,
  } = input;
  const orderedRows = view === "tasks" ? taskRowsByRank(tasks) : taskTreeRows(tasks);
  const matchedRows = orderedRows.filter(
    ({ task }) =>
      (filters.temperature === "all" || task.temperature === filters.temperature) &&
      (filters.status === "all" || task.status === filters.status) &&
      matchesTaskGroupFilter(task, filters.group) &&
      matchesTagKeyword(task.tags, filters.tag) &&
      (view === "today" || matchesTaskTimeFilter(task, filters.time, currentDate)),
  );
  const matchedIds = new Set(matchedRows.map(({ task }) => task.id));
  const activeCollapsedTaskIds = new Set(
    [...collapsedTaskIds].filter((id) => matchedIds.has(id)),
  );
  const visibleRows = visibleTaskTreeRows(orderedRows, activeCollapsedTaskIds)
    .filter(({ task }) => matchedIds.has(task.id));
  const queueSections = queueGroups
    .map((group): TaskQueueSection => {
      const allRows = matchedRows.filter(
        ({ task }) => taskQueueGroup(task, currentDate) === group.key,
      );
      const rows = visibleRows.filter(
        ({ task }) => taskQueueGroup(task, currentDate) === group.key,
      );
      return { ...group, allRows, rows, hiddenByParent: allRows.length - rows.length };
    })
    .filter(({ allRows }) => allRows.length > 0);
  const renderedRows = view === "tasks"
    ? queueSections.flatMap((section) => collapsedQueues.has(section.key) ? [] : section.rows)
    : visibleRows;
  const visibleTasks = matchedRows.map(({ task }) => task);
  const filterActive =
    filters.temperature !== "all" ||
    filters.status !== "all" ||
    filters.group !== "all" ||
    Boolean(filters.tag.trim()) ||
    (view === "tasks" && filters.time !== "current");
  const completed = tasks.filter((task) => task.status === "completed").length;
  const completion = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
  const activeCompletion = Object.entries(completionMotions).at(-1);
  const activeCompletionTitle = activeCompletion
    ? tasks.find((task) => task.id === activeCompletion[0])?.title ?? "任务"
    : null;
  const completionAnnouncement = activeCompletion && activeCompletionTitle
    ? activeCompletion[1] === "exiting"
      ? `${activeCompletionTitle}已标记完成，正在移出原队列`
      : activeCompletion[1] === "entering"
        ? `${activeCompletionTitle}已移入今日已完成`
        : `${activeCompletionTitle}更新失败，已恢复原状态`
    : "";

  return {
    orderedRows,
    matchedRows,
    visibleRows,
    queueSections,
    renderedRows,
    reorderScopeIds: renderedRows.map(({ task }) => task.id),
    visibleTasks,
    filterActive,
    canReorder: !filterActive,
    completed,
    completion,
    completionAnnouncement,
  };
}
