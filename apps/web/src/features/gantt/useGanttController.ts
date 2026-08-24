import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LifeOSApi } from "../../api";
import type { GanttData, GanttTask, Task, TaskGroup } from "../../types";
import {
  addDays,
  addMonths,
  dateRange,
  dayDifference,
  localDate,
  monthTimelineWindow,
  moveTimespan,
} from "../../v02-utils";

export type GanttScale = "day" | "week" | "month";
export type GanttDragOperation = "move" | "start" | "end";

export interface GanttControllerInput {
  api: Pick<LifeOSApi, "getGantt" | "getTaskGroups" | "updateTimespan">;
  taskRevision: string;
  onTaskSaved: (task: Task) => void;
  onToast: (message: string) => void;
}

export interface GanttViewModel {
  today: string;
  start: string;
  rangeStart: string;
  end: string;
  scale: GanttScale;
  goalId: string;
  data: GanttData;
  groups: TaskGroup[];
  usedGroups: TaskGroup[];
  collapsedTaskIds: ReadonlySet<string>;
  loading: boolean;
  error: string;
  days: string[];
  cellWidth: number;
}

const pixels: Record<GanttScale, number> = { day: 34, week: 18, month: 8 };

export function stableGanttTaskOrder(next: GanttTask[], previous: GanttTask[] = []): GanttTask[] {
  const previousPosition = new Map(previous.map((task, index) => [task.id, index]));
  return next
    .map((task, responseIndex) => ({ task, responseIndex }))
    .sort((left, right) => left.task.rank - right.task.rank
      || (previousPosition.get(left.task.id) ?? Number.MAX_SAFE_INTEGER)
        - (previousPosition.get(right.task.id) ?? Number.MAX_SAFE_INTEGER)
      || left.task.createdAt.localeCompare(right.task.createdAt)
      || left.task.id.localeCompare(right.task.id)
      || left.responseIndex - right.responseIndex)
    .map(({ task }) => task);
}

export async function loadGanttSnapshot(
  api: Pick<LifeOSApi, "getGantt" | "getTaskGroups">,
  start: string,
  end: string,
  goalId: string | undefined,
  previousTasks: GanttTask[] = [],
): Promise<{ data: GanttData; groups: TaskGroup[] }> {
  const ganttRequest = api.getGantt(start, end, goalId);
  const groupsRequest = api.getTaskGroups().catch(() => [] as TaskGroup[]);
  const [loaded, groups] = await Promise.all([ganttRequest, groupsRequest]);
  return { data: { ...loaded, tasks: stableGanttTaskOrder(loaded.tasks, previousTasks) }, groups };
}

export function useGanttController(input: GanttControllerInput) {
  const today = localDate(new Date());
  const [start, setStart] = useState(addDays(today, -7));
  const [scale, setScale] = useState<GanttScale>("day");
  const [goalId, setGoalId] = useState("");
  const [data, setData] = useState<GanttData>({ tasks: [], dependencies: [], criticalPath: [] });
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const taskOrderRef = useRef<GanttTask[]>([]);
  const monthWindow = useMemo(() => monthTimelineWindow(start, 180), [start]);
  const rangeStart = scale === "month" ? monthWindow.start : start;
  const rangeEnd = scale === "month" ? monthWindow.end : addDays(start, 42);
  const days = useMemo(() => dateRange(rangeStart, rangeEnd), [rangeEnd, rangeStart]);
  const end = days.at(-1) ?? rangeStart;
  const usedGroups = useMemo(() => {
    const ids = new Set(data.tasks.map((task) => task.groupId).filter(Boolean));
    return groups.filter((group) => ids.has(group.id));
  }, [data.tasks, groups]);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const loaded = await loadGanttSnapshot(input.api, rangeStart, end, goalId || undefined, taskOrderRef.current);
      taskOrderRef.current = loaded.data.tasks;
      setData(loaded.data);
      setGroups(loaded.groups);
    } catch {
      setError("甘特数据暂时无法读取。");
    } finally {
      setLoading(false);
    }
  }, [end, goalId, input.api, rangeStart]);

  useEffect(() => { void reload(); }, [input.taskRevision, reload]);

  const moveTask = useCallback(async (taskId: string, operation: GanttDragOperation, origin: string, targetDate: string) => {
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task || task.isBlocked || !origin) return;
    const delta = dayDifference(origin, targetDate);
    if (!delta) return;
    const timespan = moveTimespan(task.startAt, task.endAt, operation, delta);
    const previous = data;
    setData((current) => ({ ...current, tasks: current.tasks.map((item) => item.id === task.id ? { ...item, ...timespan } : item) }));
    try {
      const saved = await input.api.updateTimespan(task, timespan.startAt, timespan.endAt);
      input.onTaskSaved(saved);
      input.onToast("时间轴已保存");
      await reload();
    } catch (reason) {
      setData(previous);
      input.onToast(reason instanceof Error ? reason.message : "调整失败，已恢复原时间");
    }
  }, [data, input, reload]);

  const toggleTask = (taskId: string): void => setCollapsedTaskIds((current) => {
    const next = new Set(current);
    if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
    return next;
  });

  return {
    viewModel: { today, start, rangeStart, end, scale, goalId, data, groups, usedGroups, collapsedTaskIds, loading, error, days, cellWidth: pixels[scale] } satisfies GanttViewModel,
    actions: { setStart, setScale, setGoalId, reload, moveTask, toggleTask, step: (amount: number) => setStart(scale === "month" ? addMonths(start, amount) : addDays(start, amount * 7)), resetToday: () => setStart(scale === "month" ? today : addDays(today, -7)) },
  };
}
