import type { LifeOSApi } from "./api";
import type { AiCard, Rule, Task, TaskEvent } from "./types";

interface DemoStore {
  tasks: Task[];
  cards: AiCard[];
  rules: Rule[];
  events: Record<string, TaskEvent[]>;
}

const STORAGE_KEY = "lifeos.web.demo.v1";

function localDate(offset = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function stamp(offsetMinutes = 0): string {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString();
}

function seedStore(): DemoStore {
  const tasks: Task[] = [
    {
      id: "task-proposal",
      version: 3,
      title: "完成 LifeOS 技术方案第一轮",
      description: "把范围、验收标准和技术边界对齐。",
      temperature: "hot",
      status: "in_progress",
      hardness: "hard",
      deadline: localDate(1),
      plannedDate: localDate(),
      tags: ["项目", "深度工作"],
      score: 92,
      rank: 0,
      createdAt: stamp(-3800),
      updatedAt: stamp(-35),
    },
    {
      id: "task-run",
      version: 1,
      title: "傍晚跑步 3 公里",
      description: "不追配速，只要出门。",
      temperature: "hot",
      status: "todo",
      hardness: "soft",
      deadline: null,
      plannedDate: localDate(),
      tags: ["健康"],
      score: 76,
      rank: 1,
      createdAt: stamp(-2100),
      updatedAt: stamp(-190),
    },
    {
      id: "task-reading",
      version: 2,
      title: "精读《纳瓦尔宝典》第三章",
      description: "记下一个可验证的观点。",
      temperature: "warm",
      status: "todo",
      hardness: "soft",
      deadline: null,
      plannedDate: localDate(),
      tags: ["学习"],
      score: 65,
      rank: 2,
      createdAt: stamp(-4900),
      updatedAt: stamp(-460),
    },
    {
      id: "task-mentor",
      version: 1,
      title: "给导师发近况更新",
      description: "三句话就够：进展、困惑、下一步。",
      temperature: "warm",
      status: "todo",
      hardness: "soft",
      deadline: null,
      plannedDate: localDate(2),
      tags: ["关系"],
      score: 58,
      rank: 3,
      createdAt: stamp(-8500),
      updatedAt: stamp(-1400),
    },
    {
      id: "task-pottery",
      version: 1,
      title: "了解周末陶艺体验课",
      description: "",
      temperature: "cold",
      status: "todo",
      hardness: "soft",
      deadline: null,
      plannedDate: null,
      tags: ["兴趣"],
      score: 31,
      rank: 4,
      createdAt: stamp(-12000),
      updatedAt: stamp(-12000),
    },
    {
      id: "task-travel",
      version: 1,
      title: "秋天去一次徽州",
      description: "一个还没评估的念头。",
      temperature: "inspiration",
      status: "todo",
      hardness: "soft",
      deadline: null,
      plannedDate: null,
      tags: ["心愿"],
      score: 18,
      rank: 5,
      createdAt: stamp(-18000),
      updatedAt: stamp(-18000),
    },
  ];
  const cards: AiCard[] = [
    {
      id: "card-plan",
      type: "action",
      status: "pending",
      title: "给深度工作留出一整块时间",
      body: "你今天的 3 个计划项中，技术方案连续推进了 2 天。建议先完成验收标准，再切换到轻任务。",
      suggestedAction: "将「完成 LifeOS 技术方案第一轮」保持在今日首位",
      conversationId: "conversation-plan",
      messages: [],
      createdAt: stamp(-24),
    },
    {
      id: "card-pattern",
      type: "observation",
      status: "pending",
      title: "下午的计划容易被挤掉",
      body: "近 7 天里，你安排在下午的软任务有 4 次顺延。这更像时间估计问题，不是执行力问题。",
      createdAt: stamp(-82),
    },
    {
      id: "card-summary",
      type: "generation",
      status: "archived",
      title: "昨日小结",
      body: "完成了 3 项，最重要的进展是把 LifeOS 从想法推进到了可验收的方案。",
      createdAt: stamp(-760),
    },
  ];
  const rules: Rule[] = [
    {
      id: "deadline-heat",
      version: 1,
      name: "Deadline 前自动升温",
      description: "硬任务进入截止窗口时自动转为热。",
      enabled: true,
      parameters: { days: 3 },
      lastTriggeredAt: stamp(-420),
    },
    {
      id: "stale-nudge",
      version: 1,
      name: "滞留任务提醒",
      description: "热任务连续数天没有变化时生成观察卡。",
      enabled: true,
      parameters: { days: 5 },
      lastTriggeredAt: null,
    },
    {
      id: "friday-cool",
      version: 1,
      name: "周末前清理热区",
      description: "周五提醒你处理未完成的热任务。",
      enabled: false,
      parameters: { hour: 17 },
      lastTriggeredAt: null,
    },
  ];
  const events: Record<string, TaskEvent[]> = {
    "task-proposal": [
      {
        id: "event-1",
        taskId: "task-proposal",
        field: "temperature",
        oldValue: "warm",
        newValue: "hot",
        actor: "rule",
        summary: "距截止日还有 3 天，规则将任务升为热",
        createdAt: stamp(-420),
      },
      {
        id: "event-2",
        taskId: "task-proposal",
        field: "status",
        oldValue: "todo",
        newValue: "in_progress",
        actor: "user",
        summary: "状态改为进行中",
        createdAt: stamp(-35),
      },
    ],
  };
  return { tasks, cards, rules, events };
}

function loadStore(): DemoStore {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? (JSON.parse(value) as DemoStore) : seedStore();
  } catch {
    return seedStore();
  }
}

function saveStore(store: DemoStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

const pause = <T>(value: T, delay = 180): Promise<T> =>
  new Promise((resolve) => window.setTimeout(() => resolve(value), delay));

export function createDemoApi(): LifeOSApi {
  const store = loadStore();

  function taskById(id: string): Task {
    const task = store.tasks.find((item) => item.id === id);
    if (!task) throw new Error("任务不存在");
    return task;
  }

  function addEvent(
    task: Task,
    field: string,
    oldValue: unknown,
    newValue: unknown,
    summary: string,
  ): void {
    const event: TaskEvent = {
      id: crypto.randomUUID(),
      taskId: task.id,
      field,
      oldValue,
      newValue,
      actor: "user",
      summary,
      createdAt: stamp(),
    };
    store.events[task.id] = [event, ...(store.events[task.id] ?? [])];
  }

  return {
    async getTasks() {
      return pause([...store.tasks].sort((a, b) => a.rank - b.rank), 360);
    },
    async getDay(date) {
      const items = store.tasks.filter(
        (task) =>
          task.status !== "archived" &&
          task.status !== "abandoned" &&
          (task.status === "completed"
            ? task.plannedDate?.slice(0, 10) === date
            : task.plannedDate?.slice(0, 10) === date ||
              Boolean(task.deadline && task.deadline.slice(0, 10) <= date)),
      );
      return pause(items.sort((a, b) => a.rank - b.rank), 360);
    },
    async createTask(input) {
      const task: Task = {
        id: crypto.randomUUID(),
        version: 1,
        title: input.title.trim(),
        description: input.description ?? "",
        temperature: input.temperature,
        status: input.status ?? "todo",
        hardness: input.deadline ? "hard" : "soft",
        deadline: input.deadline ?? null,
        plannedDate: input.plannedDate ?? null,
        tags: input.tags ?? [],
        score: 50,
        rank: store.tasks.length,
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      store.tasks.push(task);
      addEvent(task, "created", null, task.title, "创建任务");
      saveStore(store);
      return pause(task);
    },
    async updateTask(id, version, patch) {
      const current = taskById(id);
      if (current.version !== version) throw new Error("任务已在其他地方更新，请刷新后重试");
      const next: Task = {
        ...current,
        ...patch,
        hardness: ("deadline" in patch ? patch.deadline : current.deadline) ? "hard" : "soft",
        version: current.version + 1,
        updatedAt: stamp(),
      };
      Object.entries(patch).forEach(([field, value]) => {
        const oldValue = current[field as keyof Task];
        if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
          addEvent(next, field, oldValue, value, `更新${field}`);
        }
      });
      store.tasks = store.tasks.map((task) => (task.id === id ? next : task));
      saveStore(store);
      return pause(next, 120);
    },
    async reorderTasks(orderedIds) {
      const rank = new Map(orderedIds.map((id, index) => [id, index]));
      store.tasks = store.tasks.map((task) => ({
        ...task,
        rank: rank.get(task.id) ?? task.rank,
      }));
      saveStore(store);
      await pause(undefined, 120);
    },
    async getTaskEvents(id) {
      return pause(store.events[id] ?? [], 240);
    },
    async getCards() {
      return pause([...store.cards], 420);
    },
    async decideCard(id, decision) {
      store.cards = store.cards.map((card) =>
        card.id === id
          ? { ...card, status: decision === "accept" ? "accepted" : "rejected" }
          : card,
      );
      saveStore(store);
      await pause(undefined, 160);
    },
    async discussCard(id, message) {
      const conversationId = store.cards.find((card) => card.id === id)?.conversationId ?? `conversation-${id}`;
      store.cards = store.cards.map((card) =>
        card.id === id
          ? {
              ...card,
              status: "discussing",
              conversationId: card.conversationId ?? `conversation-${id}`,
              messages: [
                ...(card.messages ?? []),
                {
                  id: crypto.randomUUID(),
                  role: "user",
                  content: message,
                  createdAt: stamp(),
                },
              ],
            }
          : card,
      );
      saveStore(store);
      return pause(conversationId, 260);
    },
    async sendMessage(conversationId, content) {
      const reply = content.includes("明天")
        ? "可以。我建议明天只保留一个深度任务，其他两项放到下午。"
        : "理解了。这条建议会保留你的考虑，不会直接更改任务。";
      store.cards = store.cards.map((card) =>
        card.conversationId === conversationId
          ? {
              ...card,
              messages: [
                ...(card.messages ?? []),
                {
                  id: crypto.randomUUID(),
                  role: "user",
                  content,
                  createdAt: stamp(),
                },
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: reply,
                  createdAt: stamp(0.02),
                },
              ],
            }
          : card,
      );
      saveStore(store);
      return pause(reply, 420);
    },
    async generateDailySummary() {
      const completed = store.tasks.filter(
        (task) => task.status === "completed" && task.plannedDate === localDate(),
      ).length;
      const card: AiCard = {
        id: crypto.randomUUID(),
        type: "generation",
        status: "pending",
        title: "今日小结",
        body: `今天完成了 ${completed} 项。进度不只是勾掉任务，更是把有限的注意力放在了真正重要的事上。`,
        createdAt: stamp(),
      };
      store.cards = [card, ...store.cards];
      saveStore(store);
      return pause(card, 620);
    },
    async getRules() {
      return pause([...store.rules], 320);
    },
    async updateRule(id, _version, patch) {
      store.rules = store.rules.map((rule) =>
        rule.id === id ? { ...rule, ...patch, version: rule.version + 1 } : rule,
      );
      saveStore(store);
      await pause(undefined, 160);
    },
    async evaluateRules() {
      await pause(undefined, 520);
    },
  };
}
