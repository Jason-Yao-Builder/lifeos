import type {
  AiCard,
  CardListResponse,
  CalendarData,
  CalendarMode,
  CarryoverDecision,
  CreateTask,
  DailyReviewContent,
  EventListResponse,
  GanttData,
  Goal,
  GoalProgress,
  MorningPlanningData,
  RepeatTemplate,
  ReviewCard,
  ReviewType,
  Rule,
  RuleListResponse,
  Task,
  TaskDependency,
  TaskEvent,
  TaskImage,
  TaskListResponse,
  TaskProgress,
  UpdateTask,
  UploadTaskImageInput,
} from "./types";
import { createDemoApi } from "./demo";

export type CreateSubtaskInput = Omit<CreateTask, "status" | "tags">;

export interface LifeOSApi {
  getTasks(): Promise<Task[]>;
  getDay(date: string): Promise<Task[]>;
  createTask(input: CreateTask): Promise<Task>;
  updateTask(id: string, version: number, patch: UpdateTask): Promise<Task>;
  reorderTasks(orderedIds: string[]): Promise<Task[]>;
  getTaskEvents(id: string): Promise<EventListResponse["items"]>;
  getTaskImages(taskId: string): Promise<TaskImage[]>;
  uploadTaskImage(taskId: string, input: UploadTaskImageInput): Promise<TaskImage>;
  getTaskImageContentUrl(taskId: string, imageId: string): string;
  deleteTaskImage(taskId: string, imageId: string): Promise<void>;
  getCards(): Promise<AiCard[]>;
  decideCard(id: string, decision: "accept" | "reject"): Promise<void>;
  discussCard(id: string, message: string): Promise<string>;
  sendMessage(conversationId: string, content: string): Promise<string>;
  generateDailySummary(): Promise<AiCard>;
  getRules(): Promise<Rule[]>;
  updateRule(
    id: string,
    version: number,
    patch: Pick<Rule, "enabled"> | Pick<Rule, "parameters">,
  ): Promise<void>;
  evaluateRules(): Promise<void>;
  getCalendar(start: string, end: string, view: CalendarMode): Promise<CalendarData>;
  rescheduleTask(task: Task, plannedDate: string): Promise<Task>;
  getGantt(start: string, end: string, goalId?: string): Promise<GanttData>;
  updateTimespan(task: Task, startAt: string, endAt: string): Promise<Task>;
  getGoals(status?: string): Promise<Goal[]>;
  createGoal(input: Pick<Goal, "title" | "description" | "timeframe">): Promise<Goal>;
  updateGoal(id: string, patch: Partial<Pick<Goal, "title" | "description" | "timeframe" | "status">>): Promise<Goal>;
  deleteGoal(id: string): Promise<void>;
  getGoalTasks(id: string): Promise<Task[]>;
  getGoalProgress(id: string): Promise<GoalProgress>;
  getDependencies(id: string): Promise<TaskDependency[]>;
  addDependency(id: string, predecessorId: string): Promise<TaskDependency>;
  deleteDependency(taskId: string, dependencyId: string): Promise<void>;
  getSubtasks(id: string): Promise<Task[]>;
  createSubtask(id: string, input: CreateSubtaskInput): Promise<Task>;
  reorderSubtasks(parentId: string, orderedIds: string[]): Promise<Task[]>;
  getTaskProgress(id: string): Promise<TaskProgress>;
  getRepeatTemplates(): Promise<RepeatTemplate[]>;
  createRepeatTemplate(input: Partial<RepeatTemplate> & Pick<RepeatTemplate, "title" | "cronExpr">): Promise<RepeatTemplate>;
  generateRepeatTemplate(id: string): Promise<void>;
  getMorning(date: string): Promise<MorningPlanningData>;
  carryover(date: string, decisions: CarryoverDecision[]): Promise<Task[]>;
  getReviews(type?: ReviewType, period?: string): Promise<ReviewCard[]>;
  createDailyPlan(date: string, plannedTaskIds: string[], decisions: CarryoverDecision[]): Promise<ReviewCard>;
  createDailyReview(date: string, content: DailyReviewContent): Promise<ReviewCard>;
  generateReview(type: "weekly" | "monthly", date: string): Promise<ReviewCard>;
}

const configuredBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(
  /\/$/,
  "",
);
const explicitDemo = import.meta.env.VITE_DEMO_MODE === "true";

export const hasConfiguredApi = !explicitDemo;

function itemsOf<T>(result: T[] | { items: T[] }): T[] {
  return Array.isArray(result) ? result : result.items;
}

function normalizeRule(value: unknown): Rule {
  const raw = value as Record<string, unknown>;
  if (raw.parameters && raw.description) return value as Rule;
  const config = raw.config && typeof raw.config === "object"
    ? (raw.config as Record<string, unknown>)
    : {};
  const parameters = Object.fromEntries(
    Object.entries(config).filter((entry): entry is [string, string | number | boolean] =>
      ["string", "number", "boolean"].includes(typeof entry[1]),
    ),
  );
  const descriptions: Record<string, string> = {
    "deadline-auto-heat": "硬任务进入截止窗口时自动转为热。",
    "stale-task-observation": "热任务连续数天没有变化时生成观察卡。",
    "friday-hot-demotion": "周五提醒你处理未完成的热任务。",
  };
  return {
    id: String(raw.id),
    version: Number(raw.version ?? 1),
    name: String(raw.name ?? raw.id),
    description: descriptions[String(raw.id)] ?? "预设自动化规则。",
    enabled: Boolean(raw.enabled),
    parameters,
    lastTriggeredAt: null,
  };
}

function normalizeEvent(value: unknown): TaskEvent {
  const raw = value as Record<string, unknown>;
  if (typeof raw.summary === "string") return value as TaskEvent;
  const actorType = String(raw.actorType ?? "system");
  const actor = actorType === "human" ? "user" : actorType === "ai" ? "ai" : "rule";
  const before = raw.before && typeof raw.before === "object"
    ? raw.before as Record<string, unknown>
    : {};
  const after = raw.after && typeof raw.after === "object"
    ? raw.after as Record<string, unknown>
    : {};
  const ignored = new Set(["version", "updatedAt", "completedAt"]);
  const changedField = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .find((key) =>
      !ignored.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]),
    );
  const eventType = String(raw.type ?? "task.updated");
  const fieldLabels: Record<string, string> = {
    title: "标题",
    temperature: "温度",
    status: "状态",
    deadline: "Deadline",
    plannedDate: "计划日",
    tags: "标签",
    description: "描述",
    rank: "顺序",
  };
  const summary = eventType === "task.created"
    ? "创建任务"
    : eventType === "task.reordered"
      ? "调整顺序"
      : eventType === "task.deleted"
        ? "归档任务"
        : `更新${fieldLabels[changedField ?? ""] ?? changedField ?? "任务"}`;
  return {
    id: String(raw.id),
    taskId: String(raw.entityId ?? ""),
    field: changedField ?? eventType,
    oldValue: eventType === "task.created" ? null : before[changedField ?? ""] ?? null,
    newValue: eventType === "task.created" ? after.title ?? null : after[changedField ?? ""] ?? null,
    actor,
    summary,
    createdAt: String(raw.createdAt),
  };
}

function apiRoot(): string {
  if (!configuredBase) return "/api/v1";
  return configuredBase.endsWith("/api/v1")
    ? configuredBase
    : `${configuredBase}/api/v1`;
}

function responseErrorMessage(body: string, status: number): string {
  if (!body) return `请求失败（${status}）`;
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: unknown;
        details?: Array<{ path?: unknown; message?: unknown }>;
      };
    };
    const message = typeof parsed.error?.message === "string" ? parsed.error.message : "";
    const details = parsed.error?.details
      ?.filter((detail) => typeof detail.message === "string")
      .map((detail) => typeof detail.path === "string" && detail.path
        ? `${detail.path}: ${String(detail.message)}`
        : String(detail.message))
      .join("；");
    if (message && details) return `${message}：${details}`;
    if (message) return message;
  } catch {
    return body;
  }
  return body;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${apiRoot()}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(responseErrorMessage(body, response.status));
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

const httpApi: LifeOSApi = {
  async getTasks() {
    return itemsOf(await request<Task[] | TaskListResponse>("/tasks?limit=500"));
  },
  async getDay(date) {
    return itemsOf(await request<Task[] | TaskListResponse>(`/days/${date}`));
  },
  createTask(input) {
    return request<Task>("/tasks", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async updateTask(id, version, patch) {
    const result = await request<Task | { task: Task }>(`/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ version, patch }),
    });
    return "task" in result ? result.task : result;
  },
  async reorderTasks(orderedIds) {
    return itemsOf(await request<Task[] | TaskListResponse>("/tasks/reorder", {
      method: "POST",
      body: JSON.stringify({ orderedIds }),
    }));
  },
  async getTaskEvents(id) {
    return itemsOf(
      await request<unknown[] | EventListResponse>(`/tasks/${id}/events`),
    ).map(normalizeEvent);
  },
  async getTaskImages(taskId) {
    return itemsOf(await request<TaskImage[] | { items: TaskImage[] }>(
      `/tasks/${encodeURIComponent(taskId)}/images`,
    ));
  },
  uploadTaskImage(taskId, input) {
    return request<TaskImage>(`/tasks/${encodeURIComponent(taskId)}/images`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  getTaskImageContentUrl(taskId, imageId) {
    return `${apiRoot()}/tasks/${encodeURIComponent(taskId)}/images/${encodeURIComponent(imageId)}/content`;
  },
  async deleteTaskImage(taskId, imageId) {
    await request(
      `/tasks/${encodeURIComponent(taskId)}/images/${encodeURIComponent(imageId)}`,
      { method: "DELETE" },
    );
  },
  async getCards() {
    return itemsOf(await request<AiCard[] | CardListResponse>("/cards"));
  },
  async decideCard(id, decision) {
    await request(`/cards/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    });
  },
  async discussCard(id, message) {
    const conversation = await request<{
      id?: string;
      conversationId?: string;
      message?: unknown;
    }>(`/cards/${id}/discuss`, {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    const conversationId = conversation.id ?? conversation.conversationId ?? `card-${id}`;
    if (!conversation.message && conversationId !== `card-${id}`) {
      await request(`/conversations/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: message }),
      });
    }
    return conversationId;
  },
  async sendMessage(conversationId, content) {
    const result = await request<{ message?: { content: string }; content?: string }>(
      `/conversations/${conversationId}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ content }),
      },
    );
    return result.message?.content ?? result.content ?? "已记下，我会把这个考虑写回建议。";
  },
  async generateDailySummary() {
    return (await request<{ card: AiCard }>("/ai/daily-summary", {
      method: "POST",
    })).card;
  },
  async getRules() {
    return itemsOf(await request<unknown[] | RuleListResponse>("/rules")).map(normalizeRule);
  },
  async updateRule(id, version, patch) {
    const apiPatch = "parameters" in patch
      ? { config: patch.parameters }
      : { enabled: patch.enabled };
    await request(`/rules/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ version, patch: apiPatch }),
    });
  },
  async evaluateRules() {
    await request("/rules/evaluate", { method: "POST" });
  },
  async getCalendar(start, end, view) {
    const query = new URLSearchParams({ start, end, view });
    return request<CalendarData>(`/calendar?${query}`);
  },
  async rescheduleTask(task, plannedDate) {
    return request<Task>(`/tasks/${task.id}/reschedule`, {
      method: "PATCH",
      body: JSON.stringify({ version: task.version, plannedDate }),
    });
  },
  async getGantt(start, end, goalId) {
    const query = new URLSearchParams({ start, end });
    if (goalId) query.set("goalId", goalId);
    const raw = await request<{
      tasks: Array<Omit<Task, "progress"> & {
        startsAt?: string | null;
        endsAt?: string | null;
        progress: number | TaskProgress;
      }>;
      dependencies: TaskDependency[];
      criticalPath: string[];
    }>(`/gantt?${query}`);
    return {
      ...raw,
      tasks: raw.tasks.map((task) => ({
        ...task,
        startAt: task.startsAt ?? task.startAt ?? null,
        endAt: task.endsAt ?? task.endAt ?? null,
        progress: typeof task.progress === "number" ? task.progress : task.progress.percent,
        isBlocked: task.isBlocked ?? false,
      })),
    };
  },
  async updateTimespan(task, startAt, endAt) {
    return request<Task>(`/tasks/${task.id}/timespan`, {
      method: "PATCH",
      body: JSON.stringify({ version: task.version, startAt, endAt }),
    });
  },
  async getGoals(status) {
    const query = status ? `?${new URLSearchParams({ status })}` : "";
    return itemsOf(await request<Goal[] | { items: Goal[] }>(`/goals${query}`));
  },
  createGoal(input) {
    return request<Goal>("/goals", { method: "POST", body: JSON.stringify(input) });
  },
  updateGoal(id, patch) {
    return request<Goal>(`/goals/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  async deleteGoal(id) {
    await request(`/goals/${id}`, { method: "DELETE" });
  },
  async getGoalTasks(id) {
    return itemsOf(await request<Task[] | TaskListResponse>(`/goals/${id}/tasks`));
  },
  getGoalProgress(id) {
    return request<GoalProgress>(`/goals/${id}/progress`);
  },
  async getDependencies(id) {
    const value = await request<
      TaskDependency[] | { predecessors: TaskDependency[]; successors: TaskDependency[] }
    >(`/tasks/${id}/dependencies`);
    return Array.isArray(value) ? value : [...value.predecessors, ...value.successors];
  },
  addDependency(id, predecessorId) {
    return request<TaskDependency>(`/tasks/${id}/dependencies`, {
      method: "POST",
      body: JSON.stringify({ predecessorId, type: "finish_to_start" }),
    });
  },
  async deleteDependency(taskId, dependencyId) {
    await request(`/tasks/${taskId}/dependencies/${dependencyId}`, { method: "DELETE" });
  },
  async getSubtasks(id) {
    return itemsOf(await request<Task[] | TaskListResponse>(`/tasks/${id}/subtasks`));
  },
  createSubtask(id, input) {
    return request<Task>(`/tasks/${id}/subtasks`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async reorderSubtasks(parentId, orderedIds) {
    return itemsOf(await request<Task[] | TaskListResponse>(
      `/tasks/${encodeURIComponent(parentId)}/subtasks/reorder`,
      {
        method: "POST",
        body: JSON.stringify({ orderedIds }),
      },
    ));
  },
  getTaskProgress(id) {
    return request<TaskProgress>(`/tasks/${id}/progress`);
  },
  async getRepeatTemplates() {
    return itemsOf(await request<RepeatTemplate[] | { items: RepeatTemplate[] }>("/repeat-templates"));
  },
  createRepeatTemplate(input) {
    return request<RepeatTemplate>("/repeat-templates", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  async generateRepeatTemplate(id) {
    await request(`/repeat-templates/${id}/generate`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },
  getMorning(date) {
    return request<MorningPlanningData>(`/days/${date}/morning`);
  },
  async carryover(date, decisions) {
    const value = await request<Task[] | TaskListResponse>(`/days/${date}/carryover`, {
      method: "POST",
      body: JSON.stringify({ decisions }),
    });
    return itemsOf(value);
  },
  async getReviews(type, period) {
    const query = new URLSearchParams();
    if (type) query.set("type", type);
    if (period) query.set("period", period);
    const suffix = query.size ? `?${query}` : "";
    return itemsOf(await request<ReviewCard[] | { items: ReviewCard[] }>(`/reviews${suffix}`));
  },
  createDailyPlan(date, plannedTaskIds, decisions) {
    return request<ReviewCard>("/reviews/daily-plan", {
      method: "POST",
      body: JSON.stringify({ date, plannedTaskIds, carryoverDecisions: decisions }),
    });
  },
  createDailyReview(date, content) {
    return request<ReviewCard>("/reviews/daily-review", {
      method: "POST",
      body: JSON.stringify({
        date,
        incompleteReasons: content.incompleteReasons,
        totalFocusMinutes: content.totalFocusMinutes,
      }),
    });
  },
  generateReview(type, date) {
    return request<ReviewCard>(`/reviews/${type}`, {
      method: "POST",
      body: JSON.stringify({ date }),
    });
  },
};

export function createApi(forceDemo = false): LifeOSApi {
  return forceDemo || explicitDemo ? createDemoApi() : httpApi;
}
