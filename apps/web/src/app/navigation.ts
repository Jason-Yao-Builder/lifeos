import type { Task, TaskGroup } from "../types";
import type {
  AppReviewRoute,
  AppTaskFilters,
  AppView,
  TaskGroupNavigationItem,
  TemperatureNavigationItem,
} from "./contracts";

export const emptyTaskFilters: AppTaskFilters = {
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

export function viewForPathname(pathname: string): AppView {
  if (pathname.startsWith("/review/")) return "review";
  if (pathname.endsWith("/today")) return "today";
  if (pathname.endsWith("/calendar")) return "calendar";
  if (pathname.endsWith("/gantt")) return "gantt";
  if (pathname.endsWith("/goals")) return "goals";
  if (pathname.endsWith("/settings")) return "settings";
  return "tasks";
}

export function reviewRouteForPathname(
  pathname: string,
  fallbackDate: string,
): AppReviewRoute {
  const [, , rawType, rawDate] = pathname.split("/");
  const type = rawType === "weekly" || rawType === "monthly" ? rawType : "daily";
  return {
    type,
    date: /^\d{4}-\d{2}-\d{2}$/.test(rawDate ?? "") ? rawDate! : fallbackDate,
  };
}

export function pathForView(view: AppView, review: AppReviewRoute): string {
  return view === "review" ? `/review/${review.type}/${review.date}` : `/${view}`;
}

export function isSettingsArea(view: AppView): boolean {
  return view === "settings" || view === "goals";
}

export function isViewsArea(view: AppView): boolean {
  return view === "calendar" || view === "gantt";
}

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

export function temperatureNavigationItems(
  tasks: readonly Pick<Task, "temperature">[],
): TemperatureNavigationItem[] {
  const temperatures: readonly Exclude<AppTaskFilters["temperature"], "all">[] = [
    "hot",
    "warm",
    "cold",
    "inspiration",
  ];
  const labels: Record<Exclude<AppTaskFilters["temperature"], "all">, string> = {
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

export function taskFiltersForGroup(
  filters: AppTaskFilters,
  group: AppTaskFilters["group"],
): AppTaskFilters {
  return { ...filters, group };
}

export function taskFiltersForTemperature(
  filters: AppTaskFilters,
  temperature: AppTaskFilters["temperature"],
): AppTaskFilters {
  return { ...filters, temperature };
}

export function taskGroupFromLocation(
  pathname: string,
  search: string,
): AppTaskFilters["group"] {
  if (pathname !== "/tasks") return "all";
  const rawGroup = new URLSearchParams(search).get("group")?.trim();
  return rawGroup && rawGroup !== "all" ? rawGroup : "all";
}

export function taskTemperatureFromLocation(
  pathname: string,
  search: string,
): AppTaskFilters["temperature"] {
  if (pathname !== "/tasks") return "all";
  const rawTemperature = new URLSearchParams(search).get("temperature")?.trim() ?? "all";
  return taskFilterTemperatures.has(rawTemperature)
    ? rawTemperature as AppTaskFilters["temperature"]
    : "all";
}

export function taskGroupPath(
  group: AppTaskFilters["group"],
  temperature: AppTaskFilters["temperature"] = "all",
): string {
  const search = new URLSearchParams();
  if (group !== "all") search.set("group", group);
  if (temperature !== "all") search.set("temperature", temperature);
  const query = search.toString();
  return query ? `/tasks?${query}` : "/tasks";
}

export function isKnownTaskGroup(
  group: AppTaskFilters["group"],
  groups: readonly Pick<TaskGroup, "id">[],
): boolean {
  return group === "all" || group === "ungrouped" || groups.some((item) => item.id === group);
}

function isTaskFilters(value: unknown): value is AppTaskFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<Record<keyof AppTaskFilters, unknown>>;
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
): AppTaskFilters {
  if (viewForPathname(pathname) !== "tasks") return { ...emptyTaskFilters };
  const stored = state && typeof state === "object" && !Array.isArray(state)
    ? (state as Record<string, unknown>)[taskFiltersHistoryKey]
    : null;
  const filters = isTaskFilters(stored) ? stored : emptyTaskFilters;
  return {
    ...filters,
    group: taskGroupFromLocation(pathname, search),
    temperature: taskTemperatureFromLocation(pathname, search),
  };
}

export function taskHistoryState(
  filters: AppTaskFilters,
  state: unknown,
): Record<string, unknown> {
  const existing = state && typeof state === "object" && !Array.isArray(state)
    ? state as Record<string, unknown>
    : {};
  return { ...existing, [taskFiltersHistoryKey]: { ...filters } };
}

export function shouldPushTaskGroupNavigation(
  pathname: string,
  search: string,
  currentGroup: AppTaskFilters["group"],
  nextGroup: AppTaskFilters["group"],
  temperature: AppTaskFilters["temperature"] = "all",
): boolean {
  return currentGroup !== nextGroup ||
    `${pathname}${search}` !== taskGroupPath(nextGroup, temperature);
}

export function shouldPushTaskTemperatureNavigation(
  pathname: string,
  search: string,
  group: AppTaskFilters["group"],
  currentTemperature: AppTaskFilters["temperature"],
  nextTemperature: AppTaskFilters["temperature"],
): boolean {
  return currentTemperature !== nextTemperature ||
    `${pathname}${search}` !== taskGroupPath(group, nextTemperature);
}
