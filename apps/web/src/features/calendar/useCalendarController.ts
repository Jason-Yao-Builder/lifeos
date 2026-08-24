import { useCallback, useEffect, useMemo, useState } from "react";
import type { LifeOSApi } from "../../api";
import type { CalendarData, CalendarMode, Task } from "../../types";
import {
  addDays,
  dateRange,
  localDate,
  monthGrid,
  startOfWeek,
  stepCalendarAnchor,
} from "../../v02-utils";

export interface CalendarControllerInput {
  api: Pick<LifeOSApi, "getCalendar" | "rescheduleTask">;
  tasks: Task[];
  onTaskSaved: (task: Task) => void;
  onToast: (message: string) => void;
}

export interface CalendarViewModel {
  today: string;
  anchor: string;
  mode: CalendarMode;
  data: CalendarData;
  loading: boolean;
  error: string;
  days: string[];
  start: string;
  end: string;
  title: string;
}

export interface CalendarActions {
  setAnchor: (anchor: string) => void;
  setMode: (mode: CalendarMode) => void;
  step: (amount: number) => void;
  reload: () => Promise<void>;
  moveTask: (taskId: string, date: string) => Promise<void>;
}

export interface CalendarController {
  viewModel: CalendarViewModel;
  actions: CalendarActions;
}

export function calendarRange(anchor: string, mode: CalendarMode): string[] {
  if (mode === "day") return [anchor];
  if (mode === "week") return dateRange(startOfWeek(anchor), addDays(startOfWeek(anchor), 6));
  return monthGrid(anchor);
}

export function calendarDateLabel(date: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" })
    .format(new Date(`${date}T12:00:00`));
}

export function moveTaskInCalendar(data: CalendarData, task: Task, date: string): CalendarData {
  const days = Object.fromEntries(Object.entries(data.days).map(([key, value]) => [key, {
    ...value,
    tasks: value.tasks.filter((item) => item.id !== task.id),
    repeatTasks: value.repeatTasks.filter((item) => item.id !== task.id),
  }]));
  const next = { ...task, plannedDate: date };
  days[date] ??= { tasks: [], deadlineTasks: [], repeatTasks: [] };
  days[date].tasks.push(next);
  if (task.repeatTemplateId) days[date].repeatTasks.push(next);
  return { days };
}

export function useCalendarController(input: CalendarControllerInput): CalendarController {
  const today = localDate(new Date());
  const [anchor, setAnchor] = useState(today);
  const [mode, setMode] = useState<CalendarMode>("month");
  const [data, setData] = useState<CalendarData>({ days: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const days = useMemo(() => calendarRange(anchor, mode), [anchor, mode]);
  const start = days[0] ?? anchor;
  const end = days.at(-1) ?? anchor;

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      setData(await input.api.getCalendar(start, end, mode));
    } catch {
      setError("日历数据暂时无法读取。");
    } finally {
      setLoading(false);
    }
  }, [end, input.api, mode, start]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const moveTask = useCallback(async (taskId: string, date: string): Promise<void> => {
    const task = input.tasks.find((item) => item.id === taskId);
    if (!task || task.plannedDate?.slice(0, 10) === date) return;
    const previous = data;
    setData((current) => moveTaskInCalendar(current, task, date));
    try {
      const saved = await input.api.rescheduleTask(task, date);
      input.onTaskSaved(saved);
      input.onToast(`已移到 ${date}`);
      await reload();
    } catch (reason) {
      setData(previous);
      input.onToast(reason instanceof Error ? reason.message : "移动失败，已恢复原日期");
    }
  }, [data, input, reload]);

  const title = mode === "month"
    ? `${anchor.slice(0, 4)} 年 ${Number(anchor.slice(5, 7))} 月`
    : mode === "week"
      ? `${calendarDateLabel(start)} — ${calendarDateLabel(end)}`
      : calendarDateLabel(anchor);

  return {
    viewModel: { today, anchor, mode, data, loading, error, days, start, end, title },
    actions: {
      setAnchor,
      setMode,
      step: (amount) => setAnchor((current) => stepCalendarAnchor(current, mode, amount)),
      reload,
      moveTask,
    },
  };
}
