import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement } from "react";
import { createApi, hasConfiguredApi } from "./api";
import type { CreateSubtaskInput, LifeOSApi } from "./api";
import { GoalsView } from "./GoalsView";
import { CoachIcon, SettingsIcon } from "./Icons";
import { MorningPlanner, ReviewView } from "./ReviewView";
import { taskCompletionMotionDuration } from "./TaskBoard";
import type { TaskCompletionMotion } from "./TaskBoard";
import type { AiCard, Goal, Rule, Task, TaskGroup, UpdateTask } from "./types";
import { todayKey } from "./utils";
import { mergeScopedOrder, reorderTaskIds } from "./v02-utils";
import type { TaskDropPosition } from "./v02-utils";
import { useLifeOSUI } from "./ui";
import type {
  AppLoadState,
  AppReviewRoute,
  AppShellActions,
  AppShellViewModel,
  AppTaskFilters,
  AppView,
} from "./app/contracts";
import { loadApplicationData, taskBelongsToDate } from "./app/data-controller";
import {
  loadRollForwardDate,
  loadTaskEditorPlaceholders,
  saveRollForwardDate,
  saveTaskEditorPlaceholders,
  validRollForwardDate,
} from "./app/preferences";
import type { TaskEditorPlaceholderKey } from "./app/preferences";
import {
  emptyTaskFilters,
  isKnownTaskGroup,
  isSettingsArea,
  isViewsArea,
  pathForView,
  reviewRouteForPathname,
  shouldCloseTaskOnViewChange,
  shouldPushTaskGroupNavigation,
  taskFiltersForGroup,
  taskFiltersForHistoryEntry,
  taskGroupNavigationItems,
  taskGroupPath,
  taskHistoryState,
  viewForPathname,
} from "./app/navigation";

export { AppSidebar, TaskGroupSidebar } from "./features/shell/AppSidebar";
export type {
  AppSidebarActions,
  AppSidebarProps,
  AppSidebarViewModel,
} from "./features/shell/AppSidebar";

export type {
  AppLoadState,
  AppReviewRoute,
  AppShellActions,
  AppShellViewModel,
  AppTaskFilters,
  AppView,
  TaskGroupNavigationItem,
} from "./app/contracts";
export {
  isKnownTaskGroup,
  isSettingsArea,
  isViewsArea,
  shouldCloseTaskOnViewChange,
  shouldPushTaskGroupNavigation,
  taskFiltersForGroup,
  taskFiltersForHistoryEntry,
  taskGroupFromLocation,
  taskGroupNavigationItems,
  taskGroupPath,
  taskHistoryState,
  viewForPathname,
} from "./app/navigation";

type SidebarGroupStyle = CSSProperties & { "--sidebar-group-color"?: string };

type TaskCard =
  | { key: string; mode: "edit"; taskId: string }
  | { key: string; mode: "create-task"; task: Task }
  | { key: string; mode: "create-subtask"; task: Task; parentTaskId: string };

function taskDraft(view: AppView): Task {
  const now = new Date().toISOString();
  return {
    id: `draft-task-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    version: 1,
    title: "",
    description: null,
    temperature: "warm",
    status: "todo",
    hardness: "soft",
    deadline: null,
    plannedDate: view === "today" ? todayKey() : null,
    groupId: null,
    tags: [],
    score: null,
    rank: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function subtaskDraft(parent: Task): Task {
  const now = new Date().toISOString();
  return {
    ...parent,
    id: `draft-subtask-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    version: 1,
    title: "",
    description: null,
    deadline: null,
    startAt: null,
    endAt: null,
    parentTaskId: parent.id,
    repeatTemplateId: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

const taskEditorPlaceholderSettings: Array<{
  key: TaskEditorPlaceholderKey;
  label: string;
}> = [
  { key: "title", label: "任务名称" },
  { key: "description", label: "描述" },
  { key: "tags", label: "标签" },
];

function initialView(): AppView {
  return viewForPathname(window.location.pathname);
}

function initialTaskFilters(): AppTaskFilters {
  return taskFiltersForHistoryEntry(
    window.location.pathname,
    window.location.search,
    window.history.state,
  );
}

function reviewRoute(): AppReviewRoute {
  return reviewRouteForPathname(window.location.pathname, todayKey());
}

function replaceTask(items: Task[], next: Task): Task[] {
  return items.map((item) => (item.id === next.id ? next : item));
}

function belongsToToday(task: Task): boolean {
  return taskBelongsToDate(task, todayKey());
}

function waitForMotion(duration: number): Promise<void> {
  return duration > 0
    ? new Promise((resolve) => window.setTimeout(resolve, duration))
    : Promise.resolve();
}

export function App(): ReactElement {
  const { renderers } = useLifeOSUI();
  const {
    TaskBoard: TaskBoardRenderer,
    TaskRow: TaskRowRenderer,
    AppSidebar: AppSidebarRenderer,
    TaskDrawer: TaskDrawerRenderer,
    AiDrawer: AiDrawerRenderer,
    RulesDrawer: RulesDrawerRenderer,
    CalendarView: CalendarRenderer,
    GanttView: GanttRenderer,
  } = renderers;
  const [api] = useState<LifeOSApi>(() => createApi());
  const [demoMode] = useState(!hasConfiguredApi);
  const [view, setView] = useState<AppView>(initialView);
  const [loadState, setLoadState] = useState<AppLoadState>("loading");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [todayTasks, setTodayTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([]);
  const [review, setReview] = useState(reviewRoute);
  const [cards, setCards] = useState<AiCard[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [rollForwardDate, setRollForwardDate] = useState(() =>
    loadRollForwardDate(todayKey(), window.localStorage));
  const [taskEditorPlaceholders, setTaskEditorPlaceholders] = useState(() =>
    loadTaskEditorPlaceholders(window.localStorage));
  const [filters, setFilters] = useState<AppTaskFilters>(initialTaskFilters);
  const [taskGroupsLoaded, setTaskGroupsLoaded] = useState(false);
  const [taskGroupsExpanded, setTaskGroupsExpanded] = useState(true);
  const [taskCards, setTaskCards] = useState<TaskCard[]>([]);
  const previousViewRef = useRef(view);
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

  const resolvedTaskCards = taskCards.flatMap((card) => {
    const task = card.mode !== "edit"
      ? card.task
      : tasks.find((item) => item.id === card.taskId)
        ?? todayTasks.find((item) => item.id === card.taskId);
    return task ? [{ ...card, task }] : [];
  });
  const selectedTask = resolvedTaskCards[resolvedTaskCards.length - 1]?.task ?? null;
  const workspaceRailVisible = loadState === "ready" && (view === "tasks" || view === "today");

  function closeTaskFromWorkspaceBlank(event: ReactPointerEvent<HTMLElement>): void {
    if (taskCards.length === 0 || !workspaceRailVisible) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("button, a, input, select, textarea, label, [role='button'], .task-row")) return;
    setTaskCards([]);
  }

  function openRootTask(task: Task): void {
    setTaskCards([{ key: `task-${task.id}`, mode: "edit", taskId: task.id }]);
  }

  function openTaskDraft(): void {
    const draft = taskDraft(view);
    setTaskCards([{ key: draft.id, mode: "create-task", task: draft }]);
  }

  function openTaskCard(taskId: string): void {
    setTaskCards((current) => {
      const existingIndex = current.findIndex((card) =>
        (card.mode === "edit" ? card.taskId : card.task.id) === taskId);
      if (existingIndex >= 0) return current.slice(0, existingIndex + 1);
      return [...current, { key: `task-${taskId}`, mode: "edit", taskId }];
    });
  }

  function openSubtaskDraft(parent: Task): void {
    const draft = subtaskDraft(parent);
    setTaskCards((current) => {
      const parentIndex = current.findIndex((card) =>
        card.mode === "edit" && card.taskId === parent.id);
      const base = parentIndex >= 0 ? current.slice(0, parentIndex + 1) : current;
      return [
        ...base,
        {
          key: draft.id,
          mode: "create-subtask",
          task: draft,
          parentTaskId: parent.id,
        },
      ];
    });
  }

  function closeTopTaskCard(): void {
    setTaskCards((current) => current.slice(0, -1));
  }

  function updateTaskEditorPlaceholder(
    key: TaskEditorPlaceholderKey,
    patch: Partial<(typeof taskEditorPlaceholders)[TaskEditorPlaceholderKey]>,
  ): void {
    setTaskEditorPlaceholders((current) => {
      const next = { ...current, [key]: { ...current[key], ...patch } };
      saveTaskEditorPlaceholders(next, window.localStorage);
      return next;
    });
  }

  const loadData = useCallback(
    async (targetApi: LifeOSApi = api): Promise<void> => {
      setLoadState("loading");
      const result = await loadApplicationData(targetApi, todayKey());
      if (result.status === "error") {
        setLoadState("error");
        return;
      }
      const { snapshot } = result;
      setTasks(snapshot.tasks);
      setTodayTasks(snapshot.todayTasks);
      setCards(snapshot.cards);
      setRules(snapshot.rules);
      setGoals(snapshot.goals);
      if (snapshot.taskGroups) {
        setTaskGroups(snapshot.taskGroups);
        setTaskGroupsLoaded(true);
      }
      setAiDegraded(snapshot.aiDegraded);
      setRulesError(snapshot.rulesError);
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
    if (shouldCloseTaskOnViewChange(previousViewRef.current, view)) {
      setTaskCards([]);
    }
    previousViewRef.current = view;
  }, [view]);

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

  function navigate(next: AppView, replace = false): void {
    const nextFilters = { ...emptyTaskFilters };
    setView(next);
    setFilters(nextFilters);
    const path = pathForView(next, review);
    const state = next === "tasks" ? taskHistoryState(nextFilters, {}) : {};
    window.history[replace ? "replaceState" : "pushState"](state, "", path);
  }

  function navigateToTaskGroup(
    group: AppTaskFilters["group"],
    nextFilters: AppTaskFilters = taskFiltersForGroup(filters, group),
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

  function changeTaskFilters(nextFilters: AppTaskFilters): void {
    if (nextFilters.group !== filters.group) {
      navigateToTaskGroup(nextFilters.group, nextFilters);
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

  async function inheritParentTask(task: Task): Promise<void> {
    try {
      const saved = await api.inheritParentTask(task.id, task.version);
      acceptExternalTask(saved);
      setToast("已继承父任务的分组与标签");
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : "继承失败，任务保持不变");
      throw reason;
    }
  }

  async function rollForwardOverdue(overdueTasks: Task[]): Promise<void> {
    try {
      const saved = await api.rollForwardDeadlines(
        overdueTasks.map(({ id, version }) => ({ id, version })),
        rollForwardDate,
      );
      const savedById = new Map(saved.map((task) => [task.id, task]));
      setTasks((current) => current.map((task) => savedById.get(task.id) ?? task));
      setTodayTasks((current) => current
        .map((task) => savedById.get(task.id) ?? task)
        .filter(belongsToToday));
      setToast(`已将 ${saved.length} 项任务顺延至 ${rollForwardDate}`);
    } catch (reason) {
      setToast(reason instanceof Error ? reason.message : "顺延失败，所有任务保持不变");
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

  async function persistTaskCardUpdate(task: Task, patch: UpdateTask): Promise<void> {
    const draftCard = taskCards.find((card) =>
      card.mode !== "edit" && card.task.id === task.id);
    if (!draftCard) {
      await persistTaskUpdate(task, patch);
      return;
    }

    const title = patch.title?.trim() ?? "";
    if (draftCard.mode === "create-task") {
      const saved = await api.createTask({
        title,
        temperature: "warm",
        status: patch.status ?? "todo",
        ...(patch.description ? { description: patch.description } : {}),
        deadline: patch.deadline ?? null,
        plannedDate: patch.plannedDate ?? null,
        groupId: patch.groupId ?? null,
        tags: patch.tags ?? [],
      });
      setTasks((current) => [...current, saved].sort((left, right) => left.rank - right.rank));
      if (belongsToToday(saved)) {
        setTodayTasks((current) => [...current, saved]
          .sort((left, right) => left.rank - right.rank));
      }
      setToast("任务已创建");
      return;
    }
    if (draftCard.mode !== "create-subtask") return;

    const input: CreateSubtaskInput = {
      title,
      temperature: "warm",
      ...(patch.description ? { description: patch.description } : {}),
      deadline: patch.deadline ?? null,
      plannedDate: patch.plannedDate ?? null,
    };
    let saved = await api.createSubtask(draftCard.parentTaskId, input);
    const followUp: UpdateTask = {};
    const status = patch.status ?? task.status;
    const tags = patch.tags ?? task.tags;
    const groupId = patch.groupId ?? task.groupId;
    if (status !== saved.status) followUp.status = status;
    if (groupId !== saved.groupId) followUp.groupId = groupId;
    if (tags.join("\u0000") !== saved.tags.join("\u0000")) followUp.tags = tags;
    if (Object.keys(followUp).length > 0) {
      saved = await api.updateTask(saved.id, saved.version, followUp);
    }
    setTasks((current) => [...current.filter((item) => item.id !== saved.id), saved]
      .sort((left, right) => left.rank - right.rank));
    setTodayTasks((current) => {
      const withoutSaved = current.filter((item) => item.id !== saved.id);
      return belongsToToday(saved)
        ? [...withoutSaved, saved].sort((left, right) => left.rank - right.rank)
        : withoutSaved;
    });
    setToast("子任务已创建");
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

  const pendingCardCount = cards.filter(
    (card) => card.status === "pending" || card.status === "discussing",
  ).length;
  const selectedTaskGroupItem = taskGroupItems.find((item) => item.id === filters.group)
    ?? taskGroupItems[0];
  const shellViewModel: AppShellViewModel = {
    view,
    loadState,
    review,
    filters,
    offline,
    demoMode,
    settingsActive: isSettingsArea(view),
    viewsActive: isViewsArea(view),
    activeTaskCount: tasks.filter((task) => ["todo", "in_progress"].includes(task.status)).length,
    pendingCardCount,
    taskGroups: taskGroupItems,
    selectedTaskGroup: selectedTaskGroupItem,
  };
  const shellActions: AppShellActions = {
    navigate,
    navigateToTaskGroup,
    changeTaskFilters,
    openAi: () => {
      setTaskCards([]);
      setAiOpen(true);
    },
    openRules: () => setRulesOpen(true),
    openTask: openRootTask,
  };
  return (
    <div className={`app-shell${workspaceRailVisible ? " has-workspace-rail" : ""}`}>
      <AppSidebarRenderer
        viewModel={shellViewModel}
        actions={shellActions}
        taskGroupsExpanded={taskGroupsExpanded}
        onTaskGroupsExpandedChange={setTaskGroupsExpanded}
      />

      <main className="main-content" onPointerDown={closeTaskFromWorkspaceBlank}>
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
                style={shellViewModel.selectedTaskGroup?.color
                  ? ({ "--sidebar-group-color": shellViewModel.selectedTaskGroup.color } as SidebarGroupStyle)
                  : undefined}
              >
                <i
                  className={`sidebar-task-group-dot ${shellViewModel.selectedTaskGroup?.color ? "is-custom" : `is-${filters.group}`}`}
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
            </div>
          )}
          <div>
            <button className="icon-button" onClick={shellActions.openAi} aria-label="AI 教练建议"><CoachIcon /></button>
            <button className={`icon-button ${shellViewModel.settingsActive ? "active" : ""}`} onClick={() => shellActions.navigate("settings")} aria-label="设置" aria-current={shellViewModel.settingsActive ? "page" : undefined}><SettingsIcon /></button>
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
            <TaskBoardRenderer
              view="today"
              tasks={todayTasks}
              allTasks={tasks}
              taskGroups={taskGroups}
              filters={filters}
              tags={tags}
              onFiltersChange={changeTaskFilters}
              onCreateTask={openTaskDraft}
              onCreateTaskGroup={createTaskGroup}
              onUpdateTaskGroup={updateTaskGroup}
              onUpdate={safeTaskUpdate}
              onInheritParent={inheritParentTask}
              rollForwardTargetDate={rollForwardDate}
              onRollForwardOverdue={rollForwardOverdue}
              completionMotions={completionMotions}
              onOpen={shellActions.openTask}
              onReorder={reorderTasks}
              onViewChange={(nextView) => navigate(nextView)}
              renderers={{ TaskRow: TaskRowRenderer }}
            />
          </>
        )}
        {loadState === "ready" && view === "tasks" && (
          <TaskBoardRenderer
            view="tasks"
            tasks={tasks}
            allTasks={tasks}
            taskGroups={taskGroups}
            filters={filters}
            tags={tags}
            onFiltersChange={changeTaskFilters}
            onCreateTask={openTaskDraft}
            onCreateTaskGroup={createTaskGroup}
            onUpdateTaskGroup={updateTaskGroup}
            onUpdate={safeTaskUpdate}
            onInheritParent={inheritParentTask}
            rollForwardTargetDate={rollForwardDate}
            onRollForwardOverdue={rollForwardOverdue}
            completionMotions={completionMotions}
            onOpen={shellActions.openTask}
            onReorder={reorderTasks}
            onViewChange={(nextView) => navigate(nextView)}
            renderers={{ TaskRow: TaskRowRenderer }}
          />
        )}
        {loadState === "ready" && view === "calendar" && (
          <CalendarRenderer
            api={api}
            tasks={tasks}
            onOpen={shellActions.openTask}
            onTaskSaved={acceptExternalTask}
            onToast={setToast}
            onViewChange={(nextView: "calendar" | "gantt") => navigate(nextView)}
          />
        )}
        {loadState === "ready" && view === "gantt" && (
          <GanttRenderer
            api={api}
            goals={goals}
            taskRevision={tasks.map((task) => `${task.id}:${task.version}:${task.rank}:${task.groupId ?? ""}`).join("|")}
            onOpen={shellActions.openTask}
            onTaskSaved={acceptExternalTask}
            onReorder={reorderTasks}
            onToast={setToast}
            onViewChange={(nextView: "calendar" | "gantt") => navigate(nextView)}
          />
        )}
        {loadState === "ready" && view === "goals" && <GoalsView api={api} onOpenTask={shellActions.openTask} onToast={setToast} onGoalsChange={setGoals} onBack={() => shellActions.navigate("settings", true)} />}
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
              <button type="button" className="settings-item" onClick={shellActions.openRules}>
                <span className="settings-item-icon" aria-hidden="true">⌘</span>
                <span>
                  <strong>规则</strong>
                  <small>设置截止升温、滞留观察和周期提醒</small>
                </span>
                <i aria-hidden="true">›</i>
              </button>
              <section className="placeholder-settings" aria-labelledby="placeholder-settings-title">
                <header>
                  <span className="settings-item-icon" aria-hidden="true">Aa</span>
                  <div>
                    <strong id="placeholder-settings-title">任务编辑默认填充</strong>
                    <small>只提示输入内容，不会自动写入任务数据</small>
                  </div>
                </header>
                <div className="placeholder-setting-list">
                  {taskEditorPlaceholderSettings.map(({ key, label }) => {
                    const option = taskEditorPlaceholders[key];
                    return (
                      <div className="placeholder-setting-row" key={key}>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={option.enabled}
                          aria-label={`${label}默认填充：${option.enabled ? "已开启" : "已关闭"}`}
                          className={`switch ${option.enabled ? "on" : ""}`}
                          onClick={() => updateTaskEditorPlaceholder(key, { enabled: !option.enabled })}
                        ><span /></button>
                        <label htmlFor={`task-placeholder-${key}`}>{label}</label>
                        <input
                          id={`task-placeholder-${key}`}
                          value={option.text}
                          maxLength={120}
                          disabled={!option.enabled}
                          aria-label={`${label}默认填充文案`}
                          onChange={(event) => updateTaskEditorPlaceholder(key, { text: event.target.value })}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
              <div className="settings-item settings-item-control">
                <span className="settings-item-icon" aria-hidden="true">↪</span>
                <label htmlFor="roll-forward-target-date">
                  <strong>一键顺延日期</strong>
                  <small>逾期任务默认顺延到今天；也可以预设一个未来日期</small>
                </label>
                <input
                  id="roll-forward-target-date"
                  type="date"
                  min={todayKey()}
                  value={rollForwardDate}
                  onChange={(event) => {
                    const next = validRollForwardDate(event.currentTarget.value, todayKey());
                    setRollForwardDate(next);
                    saveRollForwardDate(next, window.localStorage);
                  }}
                />
              </div>
            </div>
          </section>
        )}
      </main>

      {workspaceRailVisible && (
        <aside className={`workspace-rail ${selectedTask ? "has-task" : "has-agent"} ${aiOpen ? "is-mobile-open" : ""}`}>
          {selectedTask ? (
            <div className="task-card-stack">
              {resolvedTaskCards.map((card, index) => {
                const active = index === resolvedTaskCards.length - 1;
                return (
                  <div className={`task-card-layer ${active ? "is-top" : ""}`} key={card.key}>
                    <TaskDrawerRenderer
                      task={card.task}
                      mode={card.mode}
                      active={active}
                      presentation="rail"
                      placeholders={taskEditorPlaceholders}
                      api={api}
                      taskGroups={taskGroups}
                      onCreateTaskGroup={createTaskGroup}
                      onClose={closeTopTaskCard}
                      onSave={persistTaskCardUpdate}
                      onOpenTask={openTaskCard}
                      onCreateSubtask={openSubtaskDraft}
                      onDismissAll={() => setTaskCards([])}
                      allTasks={tasks}
                      goals={goals}
                      onStructureChanged={() => loadData(api)}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <AiDrawerRenderer
              open
              presentation="rail"
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
          )}
        </aside>
      )}

      <nav className="mobile-nav" aria-label="移动端主导航">
        <button
          className={["tasks", "today", "review"].includes(view) ? "active" : ""}
          aria-current={["tasks", "today", "review"].includes(view) ? "page" : undefined}
          onClick={() => shellActions.navigate("tasks")}
        >
          <span>☰</span><small>任务</small>
        </button>
        <button
          className={shellViewModel.viewsActive ? "active" : ""}
          aria-current={shellViewModel.viewsActive ? "page" : undefined}
          onClick={() => {
            if (!shellViewModel.viewsActive) shellActions.navigate("calendar");
          }}
        >
          <span>▦</span><small>视图</small>
        </button>
        <button className={shellViewModel.settingsActive ? "active" : ""} aria-current={shellViewModel.settingsActive ? "page" : undefined} onClick={() => shellActions.navigate("settings")}>
          <SettingsIcon /><small>设置</small>
        </button>
      </nav>

      {!workspaceRailVisible && resolvedTaskCards.map((card, index) => {
        const active = index === resolvedTaskCards.length - 1;
        return (
          <div className={`task-overlay-card-layer ${active ? "is-top" : ""}`} key={card.key}>
            <TaskDrawerRenderer
              task={card.task}
              mode={card.mode}
              active={active}
              placeholders={taskEditorPlaceholders}
              api={api}
              taskGroups={taskGroups}
              onCreateTaskGroup={createTaskGroup}
              onClose={closeTopTaskCard}
              onSave={persistTaskCardUpdate}
              onOpenTask={openTaskCard}
              onCreateSubtask={openSubtaskDraft}
              onDismissAll={() => setTaskCards([])}
              allTasks={tasks}
              goals={goals}
              onStructureChanged={() => loadData(api)}
            />
          </div>
        );
      })}
      {!workspaceRailVisible && <AiDrawerRenderer
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
      />}
      <RulesDrawerRenderer
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
