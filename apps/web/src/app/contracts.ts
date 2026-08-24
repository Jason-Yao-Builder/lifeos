import type { AiCard, Rule, Task, TaskGroup, TaskStatus, Temperature } from "../types";

export type AppView =
  | "tasks"
  | "today"
  | "calendar"
  | "gantt"
  | "goals"
  | "review"
  | "settings";

export type AppLoadState = "loading" | "ready" | "error";

export interface AppReviewRoute {
  type: "daily" | "weekly" | "monthly";
  date: string;
}

export interface AppTaskFilters {
  temperature: "all" | Temperature;
  status: "all" | TaskStatus;
  tag: string;
  time:
    | "all"
    | "current"
    | "target_today"
    | "target_future"
    | "target_past"
    | "completed_today"
    | "completed_past";
  group: "all" | "ungrouped" | string;
}

export interface TaskGroupNavigationItem {
  id: AppTaskFilters["group"];
  label: string;
  color: string | null;
  count: number;
}

export interface TemperatureNavigationItem {
  id: AppTaskFilters["temperature"];
  label: string;
  count: number;
}

export interface AppShellViewModel {
  view: AppView;
  loadState: AppLoadState;
  review: AppReviewRoute;
  filters: AppTaskFilters;
  offline: boolean;
  demoMode: boolean;
  settingsActive: boolean;
  viewsActive: boolean;
  activeTaskCount: number;
  pendingCardCount: number;
  taskGroups: readonly TaskGroupNavigationItem[];
  temperatures: readonly TemperatureNavigationItem[];
  selectedTaskGroup: TaskGroupNavigationItem | undefined;
}

export interface AppShellActions {
  navigate(view: AppView, replace?: boolean): void;
  navigateToTaskGroup(group: AppTaskFilters["group"], filters?: AppTaskFilters): void;
  navigateToTaskTemperature(
    temperature: AppTaskFilters["temperature"],
    filters?: AppTaskFilters,
  ): void;
  changeTaskFilters(filters: AppTaskFilters): void;
  openAi(): void;
  openRules(): void;
  openTask(task: Pick<Task, "id">): void;
}

export interface AppResourceState {
  tasks: readonly Task[];
  todayTasks: readonly Task[];
  taskGroups: readonly TaskGroup[];
  cards: readonly AiCard[];
  rules: readonly Rule[];
}
