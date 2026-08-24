import type {
  CalendarData,
  CalendarMode,
  CarryoverAction,
  CarryoverDecision,
  GanttTask,
  GoalProgress,
  Task,
  TaskDependency,
  Temperature,
} from "./types";

const DAY = 86_400_000;

export function localDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(`${value.slice(0, 10)}T12:00:00`) : value;
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function addDays(value: string, amount: number): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localDate(date);
}

export function addMonths(value: string, amount: number): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  const originalDay = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + amount + 1, 0);
  const lastDay = date.getDate();
  date.setDate(Math.min(originalDay, lastDay));
  return localDate(date);
}

export function calendarAnchorForMonth(
  anchor: string,
  selectedMonth: string,
  mode: CalendarMode,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor) || !/^\d{4}-\d{2}$/.test(selectedMonth)) {
    return null;
  }
  const year = Number(selectedMonth.slice(0, 4));
  const month = Number(selectedMonth.slice(5, 7));
  const anchorYear = Number(anchor.slice(0, 4));
  const anchorMonth = Number(anchor.slice(5, 7));
  const anchorDay = Number(anchor.slice(8, 10));
  if (
    year < 1 || month < 1 || month > 12 ||
    anchorYear < 1 || anchorMonth < 1 || anchorMonth > 12 ||
    anchorDay < 1 || anchorDay > calendarMonthLength(anchorYear, anchorMonth)
  ) return null;
  const day = mode === "month"
    ? 1
    : Math.min(anchorDay, calendarMonthLength(year, month));
  return `${selectedMonth}-${String(day).padStart(2, "0")}`;
}

function calendarMonthLength(year: number, month: number): number {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1]!;
}

export function stepCalendarAnchor(anchor: string, mode: CalendarMode, amount: number): string {
  if (mode === "month") return addMonths(`${anchor.slice(0, 7)}-01`, amount);
  return addDays(anchor, amount * (mode === "week" ? 7 : 1));
}

export function dayDifference(from: string, to: string): number {
  const a = new Date(`${from.slice(0, 10)}T12:00:00`).getTime();
  const b = new Date(`${to.slice(0, 10)}T12:00:00`).getTime();
  return Math.round((b - a) / DAY);
}

export function startOfWeek(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  return localDate(date);
}

export function monthGrid(value: string): string[] {
  const date = new Date(`${value.slice(0, 7)}-01T12:00:00`);
  const start = startOfWeek(localDate(date));
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

export function dateRange(start: string, end: string): string[] {
  const length = Math.max(0, dayDifference(start, end));
  return Array.from({ length: length + 1 }, (_, index) => addDays(start, index));
}

export interface TimelineRange {
  start: string;
  end: string;
}

export function monthTimelineWindow(anchor: string, horizonDays: number): TimelineRange {
  const start = `${anchor.slice(0, 7)}-01`;
  const rawEnd = addDays(anchor, horizonDays);
  const nextMonth = new Date(`${rawEnd.slice(0, 7)}-01T12:00:00`);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  return { start, end: addDays(localDate(nextMonth), -1) };
}

export interface MonthTimelineSegment {
  month: string;
  start: string;
  end: string;
  offsetDays: number;
  dayCount: number;
  label: string;
}

export function monthTimelineSegments(days: string[]): MonthTimelineSegment[] {
  const segments: MonthTimelineSegment[] = [];
  for (const [index, day] of days.entries()) {
    const month = day.slice(0, 7);
    const current = segments.at(-1);
    if (current?.month === month) {
      current.end = day;
      current.dayCount += 1;
      continue;
    }
    const year = month.slice(0, 4);
    const previousYear = current?.month.slice(0, 4);
    const monthNumber = Number(month.slice(5, 7));
    segments.push({
      month,
      start: day,
      end: day,
      offsetDays: index,
      dayCount: 1,
      label: segments.length === 0 || year !== previousYear
        ? `${year}年${monthNumber}月`
        : `${monthNumber}月`,
    });
  }
  return segments;
}

export function taskDay(task: Task): string | null {
  return task.plannedDate?.slice(0, 10) ?? task.deadline?.slice(0, 10) ?? null;
}

export type TaskTimeFilter =
  | "current"
  | "target_today"
  | "target_future"
  | "target_past"
  | "completed_today"
  | "completed_past"
  | "all";

export type TaskQueueGroupKey =
  | "overdue"
  | "due_today"
  | "future"
  | "unscheduled"
  | "completed_today"
  | "completed_past"
  | "other_terminal";

function datePrefix(value: string | null | undefined): string | null {
  const date = value?.slice(0, 10);
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function instantLocalDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? datePrefix(value) : localDate(instant);
}

function taskCompletionDate(task: Task): string | null {
  return instantLocalDate(task.completedAt);
}

export function taskTargetDate(task: Task): string | null {
  return instantLocalDate(task.deadline) ?? datePrefix(task.plannedDate);
}

export function matchesTagKeyword(tags: readonly string[], keyword: string): boolean {
  const query = keyword.trim().toLowerCase();
  return query.length === 0 || tags.some((tag) => tag.toLowerCase().includes(query));
}

export function matchesTaskTimeFilter(
  task: Task,
  filter: TaskTimeFilter,
  today: string,
): boolean {
  if (filter === "all") return true;
  const currentDate = today.slice(0, 10);
  const completedDate = taskCompletionDate(task);
  if (filter === "current") {
    return task.status === "todo"
      || task.status === "in_progress"
      || completedDate === currentDate;
  }
  if (filter === "completed_today") return completedDate === currentDate;
  if (filter === "completed_past") return completedDate !== null && completedDate < currentDate;

  const targetDate = taskTargetDate(task);
  if (targetDate === null) return false;
  if (filter === "target_today") return targetDate === currentDate;
  if (filter === "target_future") return targetDate > currentDate;
  return targetDate < currentDate;
}

export function taskQueueGroup(task: Task, today: string): TaskQueueGroupKey {
  const currentDate = today.slice(0, 10);
  const completedDate = taskCompletionDate(task);
  if (completedDate === currentDate) return "completed_today";
  if (completedDate && completedDate < currentDate) return "completed_past";
  if (completedDate || (task.status !== "todo" && task.status !== "in_progress")) {
    return "other_terminal";
  }

  const targetDate = taskTargetDate(task);
  if (targetDate === null) return "unscheduled";
  if (targetDate < currentDate) return "overdue";
  if (targetDate === currentDate) return "due_today";
  return "future";
}

export function projectCalendar(tasks: Task[], start: string, end: string): CalendarData {
  const days = Object.fromEntries(dateRange(start, end).map((date) => [date, {
    tasks: [] as Task[], deadlineTasks: [] as Task[], repeatTasks: [] as Task[],
  }]));
  for (const task of tasks) {
    const planned = task.plannedDate?.slice(0, 10);
    const deadline = task.deadline?.slice(0, 10);
    if (planned && days[planned]) days[planned].tasks.push(task);
    if (!planned && deadline && days[deadline]) days[deadline].tasks.push(task);
    if (deadline && days[deadline]) days[deadline].deadlineTasks.push(task);
    if (task.repeatTemplateId && planned && days[planned]) days[planned].repeatTasks.push(task);
  }
  return { days };
}

export function deadlineLevel(task: Task, today: string): "due" | "soon" | null {
  if (!task.deadline || task.status === "completed") return null;
  const remaining = dayDifference(today, task.deadline.slice(0, 10));
  if (remaining <= 0) return "due";
  return remaining <= 3 ? "soon" : null;
}

function withDate(source: string | null | undefined, date: string, end = false): string {
  if (source?.includes("T")) return `${date}${source.slice(10)}`;
  return `${date}T${end ? "23:59:59" : "00:00:00"}+08:00`;
}

export function moveTimespan(
  startAt: string | null | undefined,
  endAt: string | null | undefined,
  operation: "move" | "start" | "end",
  delta: number,
): { startAt: string; endAt: string } {
  const start = startAt?.slice(0, 10) ?? endAt?.slice(0, 10) ?? localDate(new Date());
  const end = endAt?.slice(0, 10) ?? start;
  let nextStart = operation === "end" ? start : addDays(start, delta);
  let nextEnd = operation === "start" ? end : addDays(end, delta);
  if (dayDifference(nextStart, nextEnd) < 0) {
    if (operation === "start") nextStart = nextEnd;
    else nextEnd = nextStart;
  }
  return {
    startAt: withDate(startAt, nextStart),
    endAt: withDate(endAt, nextEnd, true),
  };
}

export function calculateCriticalPath(tasks: GanttTask[], dependencies: TaskDependency[]): string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const task of tasks) {
    incoming.set(task.id, []);
    outgoing.set(task.id, []);
  }
  for (const dependency of dependencies) {
    if (!byId.has(dependency.predecessorId) || !byId.has(dependency.successorId)) continue;
    incoming.get(dependency.successorId)?.push(dependency.predecessorId);
    outgoing.get(dependency.predecessorId)?.push(dependency.successorId);
  }
  const indegree = new Map([...incoming].map(([id, values]) => [id, values.length]));
  const queue = [...indegree].filter(([, value]) => value === 0).map(([id]) => id);
  const distance = new Map<string, number>();
  const previous = new Map<string, string>();
  const duration = (task: GanttTask): number => {
    const start = task.startAt?.slice(0, 10) ?? task.plannedDate?.slice(0, 10) ?? task.createdAt.slice(0, 10);
    const end = task.endAt?.slice(0, 10) ?? task.deadline?.slice(0, 10) ?? start;
    return Math.max(1, dayDifference(start, end) + 1);
  };
  for (const id of queue) distance.set(id, duration(byId.get(id)!));
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited += 1;
    for (const next of outgoing.get(id) ?? []) {
      const candidate = (distance.get(id) ?? 0) + duration(byId.get(next)!);
      if (candidate > (distance.get(next) ?? 0)) {
        distance.set(next, candidate);
        previous.set(next, id);
      }
      const remaining = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  if (visited !== tasks.length || distance.size === 0) return [];
  let cursor = [...distance].sort((a, b) => b[1] - a[1])[0]?.[0];
  const result: string[] = [];
  while (cursor) {
    result.unshift(cursor);
    cursor = previous.get(cursor);
  }
  return result;
}

export interface GanttTreeRow {
  task: GanttTask;
  depth: number;
  hasChildren: boolean;
}

export function projectGanttTree(
  tasks: GanttTask[],
  collapsedTaskIds: ReadonlySet<string>,
): GanttTreeRow[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const children = new Map<string, GanttTask[]>();
  const roots: GanttTask[] = [];
  for (const task of tasks) {
    const parentId = task.parentTaskId;
    if (!parentId || parentId === task.id || !byId.has(parentId)) {
      roots.push(task);
      continue;
    }
    const siblings = children.get(parentId) ?? [];
    siblings.push(task);
    children.set(parentId, siblings);
  }

  const rows: GanttTreeRow[] = [];
  const emitted = new Set<string>();
  const suppress = (task: GanttTask): void => {
    if (emitted.has(task.id)) return;
    emitted.add(task.id);
    for (const child of children.get(task.id) ?? []) suppress(child);
  };
  const visit = (task: GanttTask, depth: number): void => {
    if (emitted.has(task.id)) return;
    emitted.add(task.id);
    const descendants = children.get(task.id) ?? [];
    rows.push({ task, depth, hasChildren: descendants.length > 0 });
    if (collapsedTaskIds.has(task.id)) {
      for (const child of descendants) suppress(child);
      return;
    }
    for (const child of descendants) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  for (const task of tasks) {
    if (!emitted.has(task.id)) visit(task, 0);
  }
  return rows;
}

export function goalProgress(tasks: Task[], goalId: string): GoalProgress {
  const related = tasks.filter((task) => task.goalId === goalId);
  const completed = related.filter(wasCompleted).length;
  const byTemperature = related.reduce<Partial<Record<Temperature, number>>>((totals, task) => {
    totals[task.temperature] = (totals[task.temperature] ?? 0) + 1;
    return totals;
  }, {});
  return {
    completed,
    total: related.length,
    percent: related.length ? Math.round((completed / related.length) * 100) : 0,
    byTemperature,
  };
}

export function mergeScopedOrder(all: Task[], scopedIds: string[]): Task[] {
  const scoped = new Set(scopedIds);
  let index = 0;
  const byId = new Map(all.map((task) => [task.id, task]));
  return all.map((task) => scoped.has(task.id) ? byId.get(scopedIds[index++]!) ?? task : task);
}

export type TaskDropPosition = "before" | "after";

export function taskDropPosition(clientY: number, top: number, height: number): TaskDropPosition {
  return clientY < top + Math.max(0, height) / 2 ? "before" : "after";
}

export function reorderTaskIds(
  orderedIds: readonly string[],
  sourceId: string,
  targetId: string,
  position: TaskDropPosition,
): string[] {
  if (sourceId === targetId || !orderedIds.includes(sourceId) || !orderedIds.includes(targetId)) {
    return [...orderedIds];
  }
  const next = orderedIds.filter((id) => id !== sourceId);
  const targetIndex = next.indexOf(targetId);
  next.splice(targetIndex + (position === "after" ? 1 : 0), 0, sourceId);
  return next;
}

export function taskHierarchyReorderAnchor(
  tasks: readonly Task[],
  sourceId: string,
  targetId: string,
): string | null {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const source = byId.get(sourceId);
  let candidate = byId.get(targetId);
  if (!source || !candidate) return null;
  const sourceParentId = source.parentTaskId ?? null;
  const seen = new Set<string>();
  while (candidate && !seen.has(candidate.id)) {
    if (candidate.id === source.id) return null;
    if ((candidate.parentTaskId ?? null) === sourceParentId) return candidate.id;
    seen.add(candidate.id);
    candidate = candidate.parentTaskId ? byId.get(candidate.parentTaskId) : undefined;
  }
  return null;
}

export function hierarchyDepth(task: Task, tasks: Task[]): number {
  const byId = new Map(tasks.map((item) => [item.id, item]));
  const seen = new Set<string>();
  let depth = 1;
  let parentId = task.parentTaskId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = byId.get(parentId)?.parentTaskId;
  }
  return depth;
}

export interface TaskTreeRow {
  task: Task;
  depth: number;
  ancestorTitles: string[];
  lineageIssue: "missing" | "cycle" | null;
  hasChildren: boolean;
}

export function taskTreeRows(tasks: Task[], maxDepth = 3): TaskTreeRow[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const children = new Map<string, Task[]>();
  const hasValidParent = (task: Task): boolean =>
    Boolean(task.parentTaskId && task.parentTaskId !== task.id && byId.has(task.parentTaskId));

  for (const task of tasks) {
    if (!hasValidParent(task) || !task.parentTaskId) continue;
    const siblings = children.get(task.parentTaskId) ?? [];
    siblings.push(task);
    children.set(task.parentTaskId, siblings);
  }

  const rows: TaskTreeRow[] = [];
  const visited = new Set<string>();
  const lineage = (task: Task): Pick<TaskTreeRow, "ancestorTitles" | "lineageIssue"> => {
    const titles: string[] = [];
    const seen = new Set([task.id]);
    let parentId = task.parentTaskId;
    while (parentId) {
      if (seen.has(parentId)) return { ancestorTitles: titles.reverse(), lineageIssue: "cycle" };
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) return { ancestorTitles: titles.reverse(), lineageIssue: "missing" };
      titles.push(parent.title);
      parentId = parent.parentTaskId;
    }
    return { ancestorTitles: titles.reverse(), lineageIssue: null };
  };
  const visit = (task: Task, depth: number): void => {
    if (visited.has(task.id)) return;
    visited.add(task.id);
    const descendants = children.get(task.id) ?? [];
    rows.push({
      task,
      depth: Math.min(Math.max(1, maxDepth), depth),
      ...lineage(task),
      hasChildren: descendants.some((child) => !visited.has(child.id)),
    });
    for (const child of descendants) visit(child, depth + 1);
  };

  for (const task of tasks) {
    if (!hasValidParent(task)) visit(task, 1);
  }
  for (const task of tasks) {
    if (!visited.has(task.id)) visit(task, 1);
  }
  return rows;
}

export function taskRowsByRank(tasks: Task[], maxDepth = 3): TaskTreeRow[] {
  const ranked = [...tasks].sort((left, right) => left.rank - right.rank);
  const metadata = new Map(
    taskTreeRows(ranked, maxDepth).map((row) => [row.task.id, row]),
  );
  return ranked.flatMap((task) => {
    const row = metadata.get(task.id);
    return row ? [{ ...row, task }] : [];
  });
}

export function visibleTaskTreeRows(
  rows: TaskTreeRow[],
  collapsedTaskIds: ReadonlySet<string>,
): TaskTreeRow[] {
  if (collapsedTaskIds.size === 0) return rows;
  const byId = new Map(rows.map(({ task }) => [task.id, task]));
  return rows.filter(({ task }) => {
    const seen = new Set([task.id]);
    let parentId = task.parentTaskId;
    while (parentId && !seen.has(parentId)) {
      if (collapsedTaskIds.has(parentId)) return false;
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentTaskId;
    }
    return true;
  });
}

export function dailyReviewTasks(tasks: Task[], references: unknown, date: string): Task[] {
  const ids = Array.isArray(references)
    ? references.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const taskId = (item as Record<string, unknown>).taskId;
        return typeof taskId === "string" ? [taskId] : [];
      })
    : [];
  if (ids.length === 0) return tasks.filter((task) => task.plannedDate?.slice(0, 10) === date);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return ids.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
}

export function taskCompletionRate(tasks: Task[]): number {
  if (tasks.length === 0) return 0;
  const completed = tasks.filter(wasCompleted).length;
  return Math.round(completed / tasks.length * 100);
}

export function wasCompleted(task: Task): boolean {
  return task.status === "completed" || Boolean(task.completedAt);
}

export interface WeeklyCompletionPoint {
  date: string;
  rate: number;
}

export interface WeeklyGoalAggregate {
  goalId: string;
  completedCount: number;
}

export interface MonthlyGoalReviewRow {
  goalId: string;
  title: string;
  monthCompleted: number;
  completed: number;
  total: number;
  percent: number;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function boundedPercent(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : 0;
}

export function weeklyCompletionTrend(content: Record<string, unknown>): WeeklyCompletionPoint[] {
  const values = content.dailyCompletionRates;
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    const item = recordOf(value);
    return typeof item.date === "string"
      ? [{ date: item.date, rate: boundedPercent(item.rate) }]
      : [];
  });
}

export function weeklyGoalAggregates(content: Record<string, unknown>): WeeklyGoalAggregate[] {
  const values = content.goals;
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    const item = recordOf(value);
    if (typeof item.goalId !== "string") return [];
    const completedCount = Array.isArray(item.completedTaskIds)
      ? item.completedTaskIds.length
      : typeof item.monthCompleted === "number" ? item.monthCompleted : 0;
    return [{ goalId: item.goalId, completedCount }];
  });
}

export function monthlyGoalReviewRows(
  content: Record<string, unknown>,
  activeGoalIds: ReadonlySet<string>,
): MonthlyGoalReviewRow[] {
  const values = content.goals;
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    const item = recordOf(value);
    if (typeof item.goalId !== "string" || !activeGoalIds.has(item.goalId)) return [];
    return [{
      goalId: item.goalId,
      title: typeof item.title === "string" ? item.title : item.goalId,
      monthCompleted: typeof item.monthCompleted === "number" ? item.monthCompleted : 0,
      completed: typeof item.completed === "number" ? item.completed : 0,
      total: typeof item.total === "number" ? item.total : 0,
      percent: boundedPercent(item.percent),
    }];
  });
}

export interface CarryoverDraft {
  taskId: string;
  action: CarryoverAction;
  targetDate: string;
}

export function carryoverDecisionsFromDrafts(
  drafts: CarryoverDraft[],
): CarryoverDecision[] | null {
  const decisions: CarryoverDecision[] = [];
  for (const draft of drafts) {
    if (draft.action === "reschedule") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.targetDate)) return null;
      decisions.push({ taskId: draft.taskId, action: "reschedule", targetDate: draft.targetDate });
      continue;
    }
    decisions.push({ taskId: draft.taskId, action: draft.action });
  }
  return decisions;
}

export function passedPointerDragThreshold(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  threshold = 8,
): boolean {
  return Math.hypot(currentX - startX, currentY - startY) >= threshold;
}

export function dateAtHorizontalPointer(
  clientX: number,
  canvasLeft: number,
  cellWidth: number,
  dates: string[],
): string | null {
  if (dates.length === 0 || !Number.isFinite(cellWidth) || cellWidth <= 0) return null;
  const index = Math.max(0, Math.min(dates.length - 1, Math.floor((clientX - canvasLeft) / cellWidth)));
  return dates[index] ?? null;
}
