import type {
  AiCard,
  CardListResponse,
  CreateTask,
  EventListResponse,
  Rule,
  RuleListResponse,
  Task,
  TaskEvent,
  TaskListResponse,
  UpdateTask,
} from "./types";
import { createDemoApi } from "./demo";

export interface LifeOSApi {
  getTasks(): Promise<Task[]>;
  getDay(date: string): Promise<Task[]>;
  createTask(input: CreateTask): Promise<Task>;
  updateTask(id: string, version: number, patch: UpdateTask): Promise<Task>;
  reorderTasks(orderedIds: string[]): Promise<void>;
  getTaskEvents(id: string): Promise<EventListResponse["items"]>;
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
      const message = await response.text();
      throw new Error(message || `请求失败（${response.status}）`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timer);
  }
}

const httpApi: LifeOSApi = {
  async getTasks() {
    return itemsOf(await request<Task[] | TaskListResponse>("/tasks"));
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
    await request("/tasks/reorder", {
      method: "POST",
      body: JSON.stringify({ orderedIds }),
    });
  },
  async getTaskEvents(id) {
    return itemsOf(
      await request<unknown[] | EventListResponse>(`/tasks/${id}/events`),
    ).map(normalizeEvent);
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
};

export function createApi(forceDemo = false): LifeOSApi {
  return forceDemo || explicitDemo ? createDemoApi() : httpApi;
}
