import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { createApi, hasConfiguredApi } from "./api";
import type { LifeOSApi } from "./api";
import { AiDrawer, RulesDrawer, TaskDrawer } from "./Drawers";
import { CalendarView } from "./CalendarView";
import { GanttView } from "./GanttView";
import { GoalsView } from "./GoalsView";
import { CoachIcon, SettingsIcon } from "./Icons";
import { MorningPlanner, ReviewView } from "./ReviewView";
import { TaskBoard, taskCompletionMotionDuration } from "./TaskBoard";
import type { TaskCompletionMotion, TaskFilters } from "./TaskBoard";
import type { AiCard, CreateTask, Goal, Rule, Task, TaskGroup, UpdateTask } from "./types";
import { todayKey } from "./utils";
import { mergeScopedOrder, reorderTaskIds } from "./v02-utils";
import type { TaskDropPosition } from "./v02-utils";

type View = "tasks" | "today" | "calendar" | "gantt" | "goals" | "review" | "settings";
type LoadState = "loading" | "ready" | "error";

const emptyFilters: TaskFilters = {
  temperature: "all",
  status: "all",
  tag: "",
  time: "current",
  group: "all",
};

const taskFilterTemperatures = new Set(["all", "hot", "warm", "cold", "inspiration"]);
const taskFilterStatuses = new Set([
  "all",
  "todo",
  "in_progress",
  "completed",
  "archived",
  "abandoned",
]);
const taskFilterTimes = new Set([
  "all",
  "current",
  "target_today",
  "target_future",
  "target_past",
  "completed_today",
  "completed_past",
]);
const taskFiltersHistoryKey = "lifeosTaskFilters";

export function viewForPathname(pathname: string): View {
  if (pathname.startsWith("/review/")) return "review";
  if (pathname.endsWith("/today")) return "today";
  if (pathname.endsWith("/calendar")) return "calendar";
  if (pathname.endsWith("/gantt")) return "gantt";
  if (pathname.endsWith("/goals")) return "goals";
  if (pathname.endsWith("/settings")) return "settings";
  if (pathname === "/" || pathname === "") return "tasks";
  return "tasks";
}

export function isSettingsArea(view: View): boolean {
  return view === "settings" || view === "goals";
}

export function isViewsArea(view: View): boolean {
  return view === "calendar" || view === "gantt";
}

export interface TaskGroupNavigationItem {
  id: TaskFilters["group"];
  label: string;
  color: string | null;
  count: number;
}

export interface TemperatureNavigationItem {
  id: TaskFilters["temperature"];
  label: string;
  count: number;
}

type SidebarGroupStyle = CSSProperties & { "--sidebar-group-color"?: string };

export function taskGroupNavigationItems(
  tasks: readonly Pick<Task, "groupId">[],
  groups: readonly Pick<TaskGroup, "id" | "name" | "color">[],
): TaskGroupNavigationItem[] {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.groupId) counts.set(task.groupId, (counts.get(task.groupId) ?? 0) + 1);
  }
  return [
    { id: "all", label: "全部任务", color: null, count: tasks.length },
    {
      id: "ungrouped",
      label: "未分组",
      color: null,
      count: tasks.filter((task) => !task.groupId).length,
    },
    ...groups.map((group) => ({
      id: group.id,
      label: group.name,
      color: group.color,
      count: counts.get(group.id) ?? 0,
    })),
  ];
}

export function taskFiltersForGroup(
  filters: TaskFilters,
  group: TaskFilters["group"],
): TaskFilters {
  return { ...filters, group };
}

export function temperatureNavigationItems(
  tasks: readonly Pick<Task, "temperature">[],
): TemperatureNavigationItem[] {
  const temperatures: readonly Exclude<TaskFilters["temperature"], "all">[] = [
    "hot",
    "warm",
    "cold",
    "inspiration",
  ];
  const labels: Record<Exclude<TaskFilters["temperature"], "all">, string> = {
    hot: "热",
    warm: "温",
    cold: "冷",
    inspiration: "灵感",
  };
  return [
    { id: "all", label: "全部温度", count: tasks.length },
    ...temperatures.map((temperature) => ({
      id: temperature,
      label: labels[temperature],
      count: tasks.filter((task) => task.temperature === temperature).length,
    })),
  ];
}

export function taskFiltersForTemperature(
  filters: TaskFilters,
  temperature: TaskFilters["temperature"],
): TaskFilters {
  return { ...filters, temperature };
}

export function taskGroupFromLocation(pathname: string, search: string): TaskFilters["group"] {
  if (pathname !== "/tasks") return "all";
  const rawGroup = new URLSearchParams(search).get("group")?.trim();
  return rawGroup && rawGroup !== "all" ? rawGroup : "all";
}

export function taskTemperatureFromLocation(
  pathname: string,
  search: string,
): TaskFilters["temperature"] {
  if (pathname !== "/tasks") return "all";
  const rawTemperature = new URLSearchParams(search).get("temperature")?.trim() ?? "all";
  return taskFilterTemperatures.has(rawTemperature)
    ? rawTemperature as TaskFilters["temperature"]
    : "all";
}

export function taskGroupPath(
  group: TaskFilters["group"],
  temperature: TaskFilters["temperature"] = "all",
): string {
  const search = new URLSearchParams();
  if (group !== "all") search.set("group", group);
  if (temperature !== "all") search.set("temperature", temperature);
  const query = search.toString();
  return query ? `/tasks?${query}` : "/tasks";
}

export function isKnownTaskGroup(
  group: TaskFilters["group"],
  groups: readonly Pick<TaskGroup, "id">[],
): boolean {
  return group === "all" || group === "ungrouped" || groups.some((item) => item.id === group);
}

function isTaskFilters(value: unknown): value is TaskFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<Record<keyof TaskFilters, unknown>>;
  return typeof candidate.temperature === "string" &&
    taskFilterTemperatures.has(candidate.temperature) &&
    typeof candidate.status === "string" &&
    taskFilterStatuses.has(candidate.status) &&
    typeof candidate.tag === "string" &&
    typeof candidate.time === "string" &&
    taskFilterTimes.has(candidate.time) &&
    typeof candidate.group === "string";
}

export function taskFiltersForHistoryEntry(
  pathname: string,
  search: string,
  state: unknown,
): TaskFilters {
  if (viewForPathname(pathname) !== "tasks") return { ...emptyFilters };
  const stored = state && typeof state === "object" && !Array.isArray(state)
    ? (state as Record<string, unknown>)[taskFiltersHistoryKey]
    : null;
  const filters = isTaskFilters(stored) ? stored : emptyFilters;
  return {
    ...filters,
    group: taskGroupFromLocation(pathname, search),
    temperature: taskTemperatureFromLocation(pathname, search),
  };
}

export function taskHistoryState(filters: TaskFilters, state: unknown): Record<string, unknown> {
  const existing = state && typeof state === "object" && !Array.isArray(state)
    ? state as Record<string, unknown>
    : {};
  return { ...existing, [taskFiltersHistoryKey]: { ...filters } };
}

export function shouldPushTaskGroupNavigation(
  pathname: string,
  search: string,
  currentGroup: TaskFilters["group"],
  nextGroup: TaskFilters["group"],
  temperature: TaskFilters["temperature"] = "all",
): boolean {
  return currentGroup !== nextGroup ||
    `${pathname}${search}` !== taskGroupPath(nextGroup, temperature);
}

export function shouldPushTaskTemperatureNavigation(
  pathname: string,
  search: string,
  group: TaskFilters["group"],
  currentTemperature: TaskFilters["temperature"],
  nextTemperature: TaskFilters["temperature"],
): boolean {
  return currentTemperature !== nextTemperature ||
    `${pathname}${search}` !== taskGroupPath(group, nextTemperature);
}

export function TaskGroupSidebar({
  items,
  selected,
  expanded,
  onToggle,
  onSelect,
}: {
  items: readonly TaskGroupNavigationItem[];
  selected: TaskFilters["group"] | null;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (group: TaskFilters["group"]) => void;
}): ReactElement {
  return (
    <section className="sidebar-task-groups" aria-label="任务分组">
      <button
        type="button"
        className="sidebar-task-groups-toggle"
        aria-expanded={expanded}
        aria-controls="sidebar-task-group-list"
        onClick={onToggle}
      >
        <span>任务分组</span>
        <span aria-hidden="true">{expanded ? "⌄" : "›"}</span>
      </button>
      {expanded && (
        <div id="sidebar-task-group-list" className="sidebar-task-group-list" role="group" aria-label="按任务分组筛选">
          {items.map((item) => {
            const active = selected === item.id;
            const style = item.color
              ? ({ "--sidebar-group-color": item.color } as SidebarGroupStyle)
              : undefined;
            return (
              <button
                type="button"
                key={item.id}
                className={`sidebar-task-group-link ${active ? "active" : ""}`}
                style={style}
                aria-label={`${item.label}，${item.count} 项任务`}
                aria-pressed={active}
                onClick={() => onSelect(item.id)}
              >
                <i
                  className={`sidebar-task-group-dot ${item.color ? "is-custom" : `is-${item.id}`}`}
                  aria-hidden="true"
                />
                <span>{item.label}</span>
                <small>{item.count}</small>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function TemperatureSidebar({
  items,
  selected,
  expanded,
  onToggle,
  onSelect,
}: {
  items: readonly TemperatureNavigationItem[];
  selected: TaskFilters["temperature"];
  expanded: boolean;
  onToggle: () => void;
  onSelect: (temperature: TaskFilters["temperature"]) => void;
}): ReactElement {
  return (
    <section className="sidebar-task-groups sidebar-temperatures" aria-label="温度分布">
      <button
        type="button"
        className="sidebar-task-groups-toggle"
        aria-expanded={expanded}
        aria-controls="sidebar-temperature-list"
        onClick={onToggle}
      >
        <span>温度分布</span>
        <span aria-hidden="true">{expanded ? "⌄" : "›"}</span>
      </button>
      {expanded && (
        <div id="sidebar-temperature-list" className="sidebar-task-group-list" role="group" aria-label="按温度筛选">
          {items.map((item) => {
            const active = selected === item.id;
            return (
              <button
                type="button"
                key={item.id}
                className={`sidebar-task-group-link sidebar-temperature-link is-${item.id} ${active ? "active" : ""}`}
                aria-label={`${item.label}，${item.count} 项任务`}
                aria-pressed={active}
                onClick={() => onSelect(item.id)}
              >
                <i className={`sidebar-temperature-dot is-${item.id}`} aria-hidden="true" />
                <span>{item.label}</span>
                <small>{item.count}</small>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function initialView(): View {
  return viewForPathname(window.location.pathname);
}

function initialTaskFilters(): TaskFilters {
  return taskFiltersForHistoryEntry(
    window.location.pathname,
    window.location.search,
    window.history.state,
  );
}

function reviewRoute(): { type: "daily" | "weekly" | "monthly"; date: string } {
  const [, , rawType, rawDate] = window.location.pathname.split("/");
  const type = rawType === "weekly" || rawType === "monthly" ? rawType : "daily";
  return { type, date: /^\d{4}-\d{2}-\d{2}$/.test(rawDate ?? "") ? rawDate! : todayKey() };
}

function replaceTask(items: Task[], next: Task): Task[] {
  return items.map((item) => (item.id === next.id ? next : item));
}

function belongsToToday(task: Task): boolean {
  const today = todayKey();
  const plannedDate = task.plannedDate?.slice(0, 10);
  const deadline = task.deadline?.slice(0, 10);
  if (task.status === "archived" || task.status === "abandoned") return false;
  if (task.status === "completed") return plannedDate === today;
  return plannedDate === today || Boolean(deadline && deadline <= today);
}

function waitForMotion(duration: number): Promise<void> {
  return duration > 0
    ? new Promise((resolve) => window.setTimeout(resolve, duration))
    : Promise.resolve();
}

export function App(): ReactElement {
  const [api] = useState<LifeOSApi>(() => createApi());
  const [demoMode] = useState(!hasConfiguredApi);
  const [view, setView] = useState<View>(initialView);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [todayTasks, setTodayTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([]);
  const [review, setReview] = useState(reviewRoute);
  const [cards, setCards] = useState<AiCard[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [filters, setFilters] = useState<TaskFilters>(initialTaskFilters);
  const [taskGroupsLoaded, setTaskGroupsLoaded] = useState(false);
  const [taskGroupsExpanded, setTaskGroupsExpanded] = useState(true);
  const [temperaturesExpanded, setTemperaturesExpanded] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [aiDegraded, setAiDegraded] = useState(false);
  const [rulesError, setRulesError] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [evaluatingRules, setEvaluatingRules] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [completionMotions, setCompletionMotions] = useState<
    Partial<Record<string, TaskCompletionMotion>>
  >({});
  const completionMotionsRef = useRef(new Map<string, TaskCompletionMotion>());

  const selectedTask =
    tasks.find((task) => task.id === selectedTaskId) ??
    todayTasks.find((task) => task.id === selectedTaskId) ??
    null;

  const loadData = useCallback(
    async (targetApi: LifeOSApi = api): Promise<void> => {
      setLoadState("loading");
      const [taskResult, dayResult, cardResult, ruleResult, goalResult, groupResult] = await Promise.allSettled([
        targetApi.getTasks(),
        targetApi.getDay(todayKey()),
        targetApi.getCards(),
        targetApi.getRules(),
        targetApi.getGoals(),
        targetApi.getTaskGroups(),
      ]);
      if (taskResult.status === "rejected") {
        setLoadState("error");
        return;
      }
      setTasks(taskResult.value);
      const dayItems = dayResult.status === "fulfilled"
        ? dayResult.value
        : taskResult.value.filter(belongsToToday);
      const completedToday = taskResult.value.filter(
        (task) => task.status === "completed" && task.plannedDate?.slice(0, 10) === todayKey(),
      );
      setTodayTasks(
        [...dayItems, ...completedToday.filter(
          (task) => !dayItems.some((item) => item.id === task.id),
        )].sort((left, right) => left.rank - right.rank),
      );
      setCards(cardResult.status === "fulfilled" ? cardResult.value : []);
      setRules(ruleResult.status === "fulfilled" ? ruleResult.value : []);
      setGoals(goalResult.status === "fulfilled" ? goalResult.value : []);
      if (groupResult.status === "fulfilled") {
        setTaskGroups(groupResult.value);
        setTaskGroupsLoaded(true);
      }
      setAiDegraded(cardResult.status === "rejected");
      setRulesError(ruleResult.status === "rejected");
      setLoadState("ready");
    },
    [api],
  );

  useEffect(() => {
    if (initialView() === "tasks") {
      const entryFilters = initialTaskFilters();
      window.history.replaceState(
        taskHistoryState(entryFilters, window.history.state),
        "",
        taskGroupPath(entryFilters.group, entryFilters.temperature),
      );
    }
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const onPopState = (): void => {
      const nextView = initialView();
      const nextFilters = initialTaskFilters();
      setView(nextView);
      setReview(reviewRoute());
      setFilters(nextFilters);
      if (nextView === "tasks") {
        window.history.replaceState(
          taskHistoryState(nextFilters, window.history.state),
          "",
          taskGroupPath(nextFilters.group, nextFilters.temperature),
        );
      }
    };
    const onOnline = (): void => setOffline(false);
    const onOffline = (): void => setOffline(true);
    window.addEventListener("popstate", onPopState);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (
      !taskGroupsLoaded ||
      view !== "tasks" ||
      isKnownTaskGroup(filters.group, taskGroups)
    ) return;
    const normalized = taskFiltersForGroup(filters, "all");
    setFilters(normalized);
    window.history.replaceState(
      taskHistoryState(normalized, window.history.state),
      "",
      taskGroupPath("all", normalized.temperature),
    );
  }, [filters, taskGroups, taskGroupsLoaded, view]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const tags = useMemo(
    () => Array.from(new Set(tasks.flatMap((task) => task.tags))).sort(),
    [tasks],
  );
  const taskGroupItems = useMemo(
    () => taskGroupNavigationItems(tasks, taskGroups),
    [taskGroups, tasks],
  );
  const temperatureItems = useMemo(() => temperatureNavigationItems(tasks), [tasks]);

  function navigate(next: View, replace = false): void {
    const nextFilters = { ...emptyFilters };
    setView(next);
    setFilters(nextFilters);
    const path = next === "review" ? `/review/${review.type}/${review.date}` : `/${next}`;
    const state = next === "tasks" ? taskHistoryState(nextFilters, {}) : {};
    window.history[replace ? "replaceState" : "pushState"](state, "", path);
  }

  function navigateToTaskGroup(
    group: TaskFilters["group"],
    nextFilters: TaskFilters = taskFiltersForGroup(filters, group),
  ): void {
    if (
      view === "tasks" &&
      !shouldPushTaskGroupNavigation(
        window.location.pathname,
        window.location.search,
        filters.group,
        group,
        nextFilters.temperature,
      )
    ) return;
    const normalized = taskFiltersForGroup(nextFilters, group);
    setView("tasks");
    setFilters(normalized);
    window.history.pushState(
      taskHistoryState(normalized, {}),
      "",
      taskGroupPath(group, normalized.temperature),
    );
  }

  function navigateToTaskTemperature(
    temperature: TaskFilters["temperature"],
    nextFilters: TaskFilters = taskFiltersForTemperature(filters, temperature),
  ): void {
    if (
      view === "tasks" &&
      !shouldPushTaskTemperatureNavigation(
        window.location.pathname,
        window.location.search,
        nextFilters.group,
        filters.temperature,
        temperature,
      )
    ) return;
    const normalized = taskFiltersForTemperature(nextFilters, temperature);
    setView("tasks");
    setFilters(normalized);
    window.history.pushState(
      taskHistoryState(normalized, {}),
      "",
      taskGroupPath(normalized.group, temperature),
    );
  }

  function changeTaskFilters(nextFilters: TaskFilters): void {
    if (nextFilters.group !== filters.group) {
      navigateToTaskGroup(nextFilters.group, nextFilters);
      return;
    }
    if (nextFilters.temperature !== filters.temperature) {
      navigateToTaskTemperature(nextFilters.temperature, nextFilters);
      return;
    }
    setFilters(nextFilters);
    if (view === "tasks") {
      window.history.replaceState(
        taskHistoryState(nextFilters, window.history.state),
        "",
        taskGroupPath(nextFilters.group, nextFilters.temperature),
      );
    }
  }

  function navigateReview(type: "daily" | "weekly" | "monthly", date: string): void {
    setReview({ type, date });
    setView("review");
    window.history.pushState({}, "", `/review/${type}/${date}`);
  }

  function acceptExternalTask(saved: Task): void {
    setTasks((current) => replaceTask(current, saved));
    setTodayTasks((current) => {
      const exists = current.some((item) => item.id === saved.id);
      if (!belongsToToday(saved)) return current.filter((item) => item.id !== saved.id);
      return exists ? replaceTask(current, saved) : [...current, saved];
    });
  }

  async function addTask(input: CreateTask): Promise<void> {
    try {
      const created = await api.createTask(input);
      setTasks((current) => [...current, created]);
      if (belongsToToday(created)) setTodayTasks((current) => [...current, created]);
      setToast("任务已添加");
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : "添加失败，内容已保留");
      throw reason;
    }
  }

  async function inheritParentTask(task: Task): Promise<void> {
    try {
      const saved = await api.inheritParentTask(task.id, task.version);
      acceptExternalTask(saved);
      setToast("已继承父任务的分组、标签与评分");
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : "继承失败，任务保持不变");
      throw reason;
    }
  }

  async function createTaskGroup(
    input: Pick<TaskGroup, "name" | "color">,
  ): Promise<TaskGroup> {
    try {
      const created = await api.createTaskGroup(input);
      setTaskGroups((current) => [...current, created]
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN")));
      setToast("分组已创建");
      return created;
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : "分组创建失败，输入已保留");
      throw reason;
    }
  }

  async function updateTaskGroup(
    id: string,
    patch: Partial<Pick<TaskGroup, "name" | "color">>,
  ): Promise<TaskGroup> {
    try {
      const updated = await api.updateTaskGroup(id, patch);
      setTaskGroups((current) => current.map((group) => group.id === id ? updated : group));
      setToast("分组已更新");
      return updated;
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : "分组更新失败");
      throw reason;
    }
  }

  async function persistTaskUpdate(task: Task, patch: UpdateTask): Promise<void> {
    const previousTasks = tasks;
    const previousToday = todayTasks;
    const completing = patch.status === "completed" && task.status !== "completed";
    const optimisticCompletedAt = patch.status === "completed"
      ? task.completedAt ?? new Date().toISOString()
      : patch.status && patch.status !== "archived"
        ? null
        : task.completedAt ?? null;
    const optimistic: Task = {
      ...task,
      ...patch,
      completedAt: optimisticCompletedAt,
      rank: completing ? Math.max(-1, ...tasks.map((item) => item.rank)) + 1 : task.rank,
      version: task.version,
      updatedAt: new Date().toISOString(),
    };
    setTasks((current) => replaceTask(current, optimistic).sort((left, right) => left.rank - right.rank));
    setTodayTasks((current) => {
      const exists = current.some((item) => item.id === task.id);
      if (belongsToToday(optimistic)) {
        return (exists ? replaceTask(current, optimistic) : [...current, optimistic])
          .sort((left, right) => left.rank - right.rank);
      }
      return current.filter((item) => item.id !== task.id);
    });
    try {
      const saved = await api.updateTask(task.id, task.version, patch);
      setTasks((current) => replaceTask(current, saved).sort((left, right) => left.rank - right.rank));
      setTodayTasks((current) => {
        const exists = current.some((item) => item.id === saved.id);
        if (!belongsToToday(saved)) return current.filter((item) => item.id !== saved.id);
        return (exists ? replaceTask(current, saved) : [...current, saved])
          .sort((left, right) => left.rank - right.rank);
      });
    } catch (reason) {
      setTasks(previousTasks);
      setTodayTasks(previousToday);
      throw reason;
    }
  }

  function setCompletionMotion(taskId: string, motion: TaskCompletionMotion | null): void {
    if (motion) completionMotionsRef.current.set(taskId, motion);
    else completionMotionsRef.current.delete(taskId);
    setCompletionMotions(Object.fromEntries(completionMotionsRef.current));
  }

  async function completeTaskWithMotion(task: Task, patch: UpdateTask): Promise<boolean> {
    if (completionMotionsRef.current.has(task.id)) return false;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    setCompletionMotion(task.id, "exiting");
    try {
      const [saved] = await Promise.all([
        api.updateTask(task.id, task.version, patch),
        waitForMotion(taskCompletionMotionDuration("exiting", reducedMotion)),
      ]);
      setTasks((current) =>
        replaceTask(current, saved).sort((left, right) => left.rank - right.rank));
      setTodayTasks((current) => {
        const exists = current.some((item) => item.id === saved.id);
        if (!belongsToToday(saved)) return current.filter((item) => item.id !== saved.id);
        return (exists ? replaceTask(current, saved) : [...current, saved])
          .sort((left, right) => left.rank - right.rank);
      });
      setCompletionMotion(task.id, "entering");
      setToast("任务已完成，已移至今日已完成");
      await waitForMotion(taskCompletionMotionDuration("entering", reducedMotion));
      setCompletionMotion(task.id, null);
      return true;
    } catch (reason) {
      setCompletionMotion(task.id, "restoring");
      setToast(reason instanceof Error ? reason.message : "更新失败，已恢复原状态");
      await waitForMotion(taskCompletionMotionDuration("restoring", reducedMotion));
      setCompletionMotion(task.id, null);
      return false;
    }
  }

  async function safeTaskUpdate(task: Task, patch: UpdateTask): Promise<boolean> {
    if (patch.status === "completed" && task.status !== "completed") {
      return completeTaskWithMotion(task, patch);
    }
    try {
      await persistTaskUpdate(task, patch);
      return true;
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : "更新失败，已恢复原状态");
      return false;
    }
  }

  async function reorderTasks(
    sourceId: string,
    targetId: string,
    position: TaskDropPosition,
    scopeIds: string[],
  ): Promise<void> {
    const activeIds = new Set(tasks.map((task) => task.id));
    const currentScopeIds = scopeIds.filter((id) => activeIds.has(id));
    const reorderedScopeIds = reorderTaskIds(
      currentScopeIds,
      sourceId,
      targetId,
      position,
    );
    if (
      reorderedScopeIds.length !== currentScopeIds.length ||
      reorderedScopeIds.every((id, index) => id === currentScopeIds[index])
    ) return;
    const previousTasks = tasks;
    const previousToday = todayTasks;
    const reordered = mergeScopedOrder(tasks, reorderedScopeIds);
    const ranked = reordered.map((task, index) => ({ ...task, rank: index }));
    const optimisticById = new Map(ranked.map((task) => [task.id, task]));
    setTasks(ranked);
    setTodayTasks((current) =>
      current
        .map((task) => optimisticById.get(task.id) ?? task)
        .sort((left, right) => left.rank - right.rank),
    );
    try {
      const saved = await api.reorderTasks(ranked.map((task) => task.id));
      const sorted = [...saved].sort((left, right) => left.rank - right.rank);
      const savedById = new Map(sorted.map((task) => [task.id, task]));
      setTasks(sorted);
      setTodayTasks((current) =>
        current
          .map((task) => savedById.get(task.id) ?? task)
          .sort((left, right) => left.rank - right.rank),
      );
      setToast("顺序已保存");
    } catch {
      setTasks(previousTasks);
      setTodayTasks(previousToday);
      setToast("排序保存失败，已恢复原顺序");
    }
  }

  async function generateSummary(): Promise<void> {
    if (aiDegraded) {
      setAiOpen(true);
      setToast("AI 暂时离线，任务管理仍可继续");
      return;
    }
    setGeneratingSummary(true);
    try {
      const card = await api.generateDailySummary();
      setCards((current) => [card, ...current.filter((item) => item.id !== card.id)]);
      setAiOpen(true);
      setToast("今日小结已生成");
    } catch {
      setAiDegraded(true);
      setAiOpen(true);
      setToast("AI 暂时无响应，不影响任务数据");
    } finally {
      setGeneratingSummary(false);
    }
  }

  async function decideCard(card: AiCard, decision: "accept" | "reject"): Promise<void> {
    const previous = cards;
    setCards((current) =>
      current.map((item) =>
        item.id === card.id
          ? { ...item, status: decision === "accept" ? "accepted" : "rejected" }
          : item,
      ),
    );
    try {
      await api.decideCard(card.id, decision);
      if (decision === "accept") {
        const [nextTasks, nextTodayTasks] = await Promise.all([
          api.getTasks(),
          api.getDay(todayKey()),
        ]);
        setTasks(nextTasks);
        setTodayTasks(nextTodayTasks);
      }
      setToast(decision === "accept" ? "建议已接受并留痕" : "建议已拒绝并留痕");
    } catch {
      setCards(previous);
      setToast("决定保存失败，已恢复建议卡");
    }
  }

  async function beginDiscussion(card: AiCard, message: string): Promise<void> {
    const conversationId = await api.discussCard(card.id, message);
    setCards((current) =>
      current.map((item) =>
        item.id === card.id
          ? {
              ...item,
              status: "discussing",
              conversationId,
              messages: [
                ...(item.messages ?? []),
                {
                  id: crypto.randomUUID(),
                  role: "user",
                  content: message,
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : item,
      ),
    );
  }

  async function sendMessage(card: AiCard, content: string): Promise<void> {
    const conversationId = card.conversationId ?? `card-${card.id}`;
    const userMessage = {
      id: crypto.randomUUID(),
      role: "user" as const,
      content,
      createdAt: new Date().toISOString(),
    };
    setCards((current) =>
      current.map((item) =>
        item.id === card.id
          ? { ...item, messages: [...(item.messages ?? []), userMessage] }
          : item,
      ),
    );
    try {
      const reply = await api.sendMessage(conversationId, content);
      setCards((current) =>
        current.map((item) =>
          item.id === card.id
            ? {
                ...item,
                messages: [
                  ...(item.messages ?? []),
                  {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: reply,
                    createdAt: new Date().toISOString(),
                  },
                ],
              }
            : item,
        ),
      );
    } catch {
      setAiDegraded(true);
      setToast("消息未送达，已保留在当前卡片");
    }
  }

  async function updateRule(
    rule: Rule,
    patch: Partial<Pick<Rule, "enabled" | "parameters">>,
  ): Promise<void> {
    const previous = rules;
    setRules((current) =>
      current.map((item) =>
        item.id === rule.id ? { ...item, ...patch, version: item.version + 1 } : item,
      ),
    );
    try {
      if (patch.enabled !== undefined) {
        await api.updateRule(rule.id, rule.version, { enabled: patch.enabled });
      }
      if (patch.parameters !== undefined) {
        await api.updateRule(rule.id, rule.version, { parameters: patch.parameters });
      }
      setToast("规则已保存");
    } catch {
      setRules(previous);
      setToast("规则保存失败，已恢复原设置");
    }
  }

  async function evaluateRules(): Promise<void> {
    setEvaluatingRules(true);
    try {
      await api.evaluateRules();
      setToast("规则检查完成，所有动作都已留痕");
      await loadData(api);
    } catch {
      setToast("规则检查失败，未修改任务");
    } finally {
      setEvaluatingRules(false);
    }
  }

  async function retryRules(): Promise<void> {
    try {
      setRules(await api.getRules());
      setRulesError(false);
    } catch {
      setRulesError(true);
    }
  }

  const pendingCards = cards.filter(
    (card) => card.status === "pending" || card.status === "discussing",
  ).length;
  const settingsActive = isSettingsArea(view);
  const viewsActive = isViewsArea(view);
  const selectedTaskGroupItem = taskGroupItems.find((item) => item.id === filters.group)
    ?? taskGroupItems[0];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><i /></span>
          <div><strong>LifeOS</strong><small>把时间留给重要的事</small></div>
        </div>
        <nav className="primary-nav" aria-label="主导航">
          <button
            type="button"
            className={["tasks", "today", "review"].includes(view) ? "active" : ""}
            aria-current={["tasks", "today", "review"].includes(view) ? "page" : undefined}
            onClick={() => navigate("tasks")}
          >
            <span aria-hidden="true">☰</span>
            <span>任务</span>
            <small>{tasks.filter((task) => ["todo", "in_progress"].includes(task.status)).length}</small>
          </button>
          <button
            type="button"
            className={viewsActive ? "active" : ""}
            aria-current={viewsActive ? "page" : undefined}
            onClick={() => {
              if (!viewsActive) navigate("calendar");
            }}
          >
            <span aria-hidden="true">▦</span><span>视图</span>
          </button>
        </nav>
        <div className="sidebar-section">
          <span className="sidebar-label">协同</span>
          <button type="button" className="sidebar-link" onClick={() => setAiOpen(true)}>
            <span><CoachIcon /></span>
            <span>AI 教练</span>
            {pendingCards > 0 && <small className="nav-badge">{pendingCards}</small>}
          </button>
        </div>
        <div className="sidebar-section">
          <span className="sidebar-label">系统</span>
          <button
            type="button"
            className={`sidebar-link ${settingsActive ? "active" : ""}`}
            aria-current={settingsActive ? "page" : undefined}
            onClick={() => navigate("settings")}
          >
            <span><SettingsIcon /></span>
            <span>设置</span>
          </button>
        </div>
        <TaskGroupSidebar
          items={taskGroupItems}
          selected={view === "tasks" ? filters.group : null}
          expanded={taskGroupsExpanded}
          onToggle={() => setTaskGroupsExpanded((current) => !current)}
          onSelect={navigateToTaskGroup}
        />
        <TemperatureSidebar
          items={temperatureItems}
          selected={filters.temperature}
          expanded={temperaturesExpanded}
          onToggle={() => setTemperaturesExpanded((current) => !current)}
          onSelect={(temperature) => changeTaskFilters(
            taskFiltersForTemperature(filters, temperature),
          )}
        />
        <div className="sidebar-foot">
          <span className="avatar">Y</span>
          <div><strong>我的 LifeOS</strong><small>{demoMode ? "本地演示数据" : "已连接私有服务"}</small></div>
          <span className={`connection-dot ${offline ? "offline" : ""}`} title={offline ? "离线" : "在线"} />
        </div>
      </aside>

      <main className="main-content">
        {(offline || demoMode) && loadState === "ready" && (
          <div className={`mode-banner ${offline ? "is-offline" : ""}`}>
            <span>{offline ? "当前离线：已加载的内容仍可查看" : "演示模式：操作会保存在这台设备"}</span>
          </div>
        )}
        <div className="mobile-topbar">
          <div className="brand compact"><span className="brand-mark"><i /></span><strong>LifeOS</strong></div>
          {(view === "tasks" || view === "today") && (
            <div className="mobile-task-filters">
              <label
                className="mobile-task-facet-filter mobile-task-group-filter"
                style={selectedTaskGroupItem?.color
                  ? ({ "--sidebar-group-color": selectedTaskGroupItem.color } as SidebarGroupStyle)
                  : undefined}
              >
                <i
                  className={`sidebar-task-group-dot ${selectedTaskGroupItem?.color ? "is-custom" : `is-${filters.group}`}`}
                  aria-hidden="true"
                />
                <select
                  aria-label="移动端任务分组"
                  value={filters.group}
                  onChange={(event) => navigateToTaskGroup(event.target.value)}
                >
                  {taskGroupItems.map((item) => (
                    <option value={item.id} key={item.id}>{item.label} · {item.count}</option>
                  ))}
                </select>
              </label>
              <label className={`mobile-task-facet-filter mobile-temperature-filter is-${filters.temperature}`}>
                <i className={`sidebar-temperature-dot is-${filters.temperature}`} aria-hidden="true" />
                <select
                  aria-label="移动端温度"
                  value={filters.temperature}
                  onChange={(event) => navigateToTaskTemperature(
                    event.target.value as TaskFilters["temperature"],
                  )}
                >
                  {temperatureItems.map((item) => (
                    <option value={item.id} key={item.id}>{item.label} · {item.count}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div>
            <button className="icon-button" onClick={() => setAiOpen(true)} aria-label="AI 教练建议"><CoachIcon /></button>
            <button className={`icon-button ${settingsActive ? "active" : ""}`} onClick={() => navigate("settings")} aria-label="设置" aria-current={settingsActive ? "page" : undefined}><SettingsIcon /></button>
          </div>
        </div>
        {loadState === "loading" && (
          <section className="board board-loading" aria-label="正在加载">
            <div className="skeleton skeleton-kicker" />
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-subtitle" />
            <div className="skeleton skeleton-add" />
            <div className="skeleton skeleton-filter" />
            {[0, 1, 2, 3].map((item) => (
              <div className="skeleton skeleton-row" key={item} />
            ))}
          </section>
        )}
        {loadState === "error" && (
          <section className="page-error" role="alert">
            <span className="error-symbol">！</span>
            <p className="eyebrow">连接未就绪</p>
            <h1>暂时无法读取任务</h1>
            <p>数据没有被修改。请检查 API 服务后重试，已输入的内容不会被伪装成成功。</p>
            <div>
              <button className="button button-primary" type="button" onClick={() => void loadData()}>重试连接</button>
            </div>
            <small>API: /api/v1/tasks</small>
          </section>
        )}
        {loadState === "ready" && view === "today" && (
          <>
            <MorningPlanner
              api={api}
              tasks={todayTasks}
              onChanged={() => loadData(api)}
              onReview={navigateReview}
              onToast={setToast}
            />
            <TaskBoard
              view="today"
              tasks={todayTasks}
              allTasks={tasks}
              taskGroups={taskGroups}
              filters={filters}
              tags={tags}
              onFiltersChange={changeTaskFilters}
              onAdd={addTask}
              onCreateTaskGroup={createTaskGroup}
              onUpdateTaskGroup={updateTaskGroup}
              onUpdate={safeTaskUpdate}
              onInheritParent={inheritParentTask}
              completionMotions={completionMotions}
              onOpen={(task) => setSelectedTaskId(task.id)}
              onReorder={reorderTasks}
              onViewChange={(nextView) => navigate(nextView)}
            />
          </>
        )}
        {loadState === "ready" && view === "tasks" && (
          <TaskBoard
            view="tasks"
            tasks={tasks}
            allTasks={tasks}
            taskGroups={taskGroups}
            filters={filters}
            tags={tags}
            onFiltersChange={changeTaskFilters}
            onAdd={addTask}
            onCreateTaskGroup={createTaskGroup}
            onUpdateTaskGroup={updateTaskGroup}
            onUpdate={safeTaskUpdate}
            onInheritParent={inheritParentTask}
            completionMotions={completionMotions}
            onOpen={(task) => setSelectedTaskId(task.id)}
            onReorder={reorderTasks}
            onViewChange={(nextView) => navigate(nextView)}
          />
        )}
        {loadState === "ready" && view === "calendar" && (
          <CalendarView
            api={api}
            tasks={tasks}
            onOpen={(task) => setSelectedTaskId(task.id)}
            onTaskSaved={acceptExternalTask}
            onToast={setToast}
            onViewChange={(nextView: "calendar" | "gantt") => navigate(nextView)}
          />
        )}
        {loadState === "ready" && view === "gantt" && (
          <GanttView
            api={api}
            goals={goals}
            taskRevision={tasks.map((task) => `${task.id}:${task.version}:${task.groupId ?? ""}`).join("|")}
            onOpen={(task) => setSelectedTaskId(task.id)}
            onTaskSaved={acceptExternalTask}
            onToast={setToast}
            onViewChange={(nextView: "calendar" | "gantt") => navigate(nextView)}
          />
        )}
        {loadState === "ready" && view === "goals" && <GoalsView api={api} onOpenTask={(task) => setSelectedTaskId(task.id)} onToast={setToast} onGoalsChange={setGoals} onBack={() => navigate("settings", true)} />}
        {loadState === "ready" && view === "review" && <ReviewView api={api} type={review.type} date={review.date} onBack={() => navigate("today")} onToast={setToast} />}
        {loadState === "ready" && view === "settings" && (
          <section className="board settings-page">
            <header className="board-header">
              <div>
                <p className="eyebrow">管理 LifeOS 的工作方式</p>
                <h1>设置</h1>
                <p className="board-subtitle">自动化、数据与偏好都从这里进入。</p>
              </div>
            </header>
            <div className="settings-page-list">
              <button type="button" className="settings-item" onClick={() => navigate("goals")}>
                <span className="settings-item-icon" aria-hidden="true">◎</span>
                <span>
                  <strong>目标管理</strong>
                  <small>建立方向、查看进度并关联任务</small>
                </span>
                <i aria-hidden="true">›</i>
              </button>
              <button type="button" className="settings-item" onClick={() => setRulesOpen(true)}>
                <span className="settings-item-icon" aria-hidden="true">⌘</span>
                <span>
                  <strong>规则</strong>
                  <small>设置截止升温、滞留观察和周期提醒</small>
                </span>
                <i aria-hidden="true">›</i>
              </button>
            </div>
          </section>
        )}
      </main>

      <nav className="mobile-nav" aria-label="移动端主导航">
        <button
          className={["tasks", "today", "review"].includes(view) ? "active" : ""}
          aria-current={["tasks", "today", "review"].includes(view) ? "page" : undefined}
          onClick={() => navigate("tasks")}
        >
          <span>☰</span><small>任务</small>
        </button>
        <button
          className={viewsActive ? "active" : ""}
          aria-current={viewsActive ? "page" : undefined}
          onClick={() => {
            if (!viewsActive) navigate("calendar");
          }}
        >
          <span>▦</span><small>视图</small>
        </button>
        <button className={settingsActive ? "active" : ""} aria-current={settingsActive ? "page" : undefined} onClick={() => navigate("settings")}>
          <SettingsIcon /><small>设置</small>
        </button>
      </nav>

      <TaskDrawer
        task={selectedTask}
        api={api}
        taskGroups={taskGroups}
        onCreateTaskGroup={createTaskGroup}
        onClose={() => setSelectedTaskId(null)}
        onSave={persistTaskUpdate}
        onOpenTask={setSelectedTaskId}
        allTasks={tasks}
        goals={goals}
        onStructureChanged={() => loadData(api)}
      />
      <AiDrawer
        open={aiOpen}
        cards={cards}
        degraded={aiDegraded}
        demoMode={demoMode}
        generating={generatingSummary}
        onClose={() => setAiOpen(false)}
        onDecision={decideCard}
        onDiscuss={beginDiscussion}
        onSend={sendMessage}
        onGenerate={generateSummary}
      />
      <RulesDrawer
        open={rulesOpen}
        rules={rules}
        error={rulesError}
        evaluating={evaluatingRules}
        onClose={() => setRulesOpen(false)}
        onUpdate={updateRule}
        onEvaluate={evaluateRules}
        onRetry={retryRules}
      />
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </div>
  );
}
