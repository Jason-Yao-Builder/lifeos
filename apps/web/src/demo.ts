import type { LifeOSApi } from "./api";
import type {
  AiCard,
  Goal,
  RepeatTemplate,
  ReviewCard,
  Rule,
  Task,
  TaskDependency,
  TaskEvent,
  TaskImage,
  UploadTaskImageInput,
} from "./types";
import { calculateCompositeScore } from "./utils";
import { calculateCriticalPath, goalProgress, projectCalendar } from "./v02-utils";

interface DemoStore {
  tasks: Task[];
  cards: AiCard[];
  rules: Rule[];
  events: Record<string, TaskEvent[]>;
  goals: Goal[];
  dependencies: TaskDependency[];
  templates: RepeatTemplate[];
  reviews: ReviewCard[];
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
      startAt: `${localDate()}T09:00:00+08:00`,
      endAt: `${localDate(2)}T18:00:00+08:00`,
      goalId: "goal-product",
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
      startAt: `${localDate()}T18:00:00+08:00`,
      endAt: `${localDate()}T19:00:00+08:00`,
      goalId: "goal-health",
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
      startAt: `${localDate(1)}T10:00:00+08:00`,
      endAt: `${localDate(2)}T17:00:00+08:00`,
      goalId: "goal-product",
      parentTaskId: "task-proposal",
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
      startAt: `${localDate(2)}T09:00:00+08:00`,
      endAt: `${localDate(3)}T18:00:00+08:00`,
      goalId: "goal-product",
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
  const goals: Goal[] = [
    {
      id: "goal-product",
      title: "完成 LifeOS v0.2",
      description: "让计划、执行与复盘形成闭环。",
      timeframe: "2026 Q3",
      status: "active",
      rank: 0,
      createdAt: stamp(-12_000),
      updatedAt: stamp(-35),
      completedAt: null,
    },
    {
      id: "goal-health",
      title: "恢复稳定运动",
      description: "每周至少三次低门槛运动。",
      timeframe: "未来 8 周",
      status: "active",
      rank: 1,
      createdAt: stamp(-9_000),
      updatedAt: stamp(-190),
      completedAt: null,
    },
  ];
  const dependencies: TaskDependency[] = [
    {
      id: "dependency-proposal-reading",
      predecessorId: "task-proposal",
      successorId: "task-reading",
      type: "finish_to_start",
      createdAt: stamp(-120),
    },
    {
      id: "dependency-reading-mentor",
      predecessorId: "task-reading",
      successorId: "task-mentor",
      type: "finish_to_start",
      createdAt: stamp(-110),
    },
  ];
  const templates: RepeatTemplate[] = [
    {
      id: "repeat-weekly-run",
      title: "每周跑步",
      description: "低门槛恢复运动节奏。",
      temperature: "warm",
      tags: ["健康"],
      estimatedMinutes: 40,
      goalId: "goal-health",
      cronExpr: "0 18 * * 2",
      timezone: "Asia/Shanghai",
      horizonDays: 28,
      enabled: true,
      lastGenerated: localDate(-1),
      createdAt: stamp(-12_000),
      updatedAt: stamp(-12_000),
    },
  ];
  return { tasks, cards, rules, events, goals, dependencies, templates, reviews: [] };
}

function loadStore(): DemoStore {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return seedStore();
    const parsed = JSON.parse(value) as Partial<DemoStore>;
    const seeded = seedStore();
    return {
      tasks: parsed.tasks ?? seeded.tasks,
      cards: parsed.cards ?? seeded.cards,
      rules: parsed.rules ?? seeded.rules,
      events: parsed.events ?? seeded.events,
      goals: parsed.goals ?? seeded.goals,
      dependencies: parsed.dependencies ?? seeded.dependencies,
      templates: parsed.templates ?? seeded.templates,
      reviews: parsed.reviews ?? seeded.reviews,
    };
  } catch {
    return seedStore();
  }
}

function saveStore(store: DemoStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

const pause = <T>(value: T, delay = 180): Promise<T> =>
  new Promise((resolve) => window.setTimeout(() => resolve(value), delay));

const DEMO_TASK_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const DEMO_TASK_IMAGE_MAX_COUNT = 20;
const DEMO_TASK_IMAGE_MAX_BASE64_CHARACTERS = Math.ceil(DEMO_TASK_IMAGE_MAX_BYTES / 3) * 4;
const DEMO_TASK_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const DEMO_BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

function decodeDemoTaskImage(value: string): Uint8Array | null {
  if (!DEMO_BASE64_PATTERN.test(value) || value.length % 4 === 1) return null;
  const firstPadding = value.indexOf("=");
  if (firstPadding !== -1 && firstPadding < value.length - 2) return null;
  if (value.includes("=") && value.length % 4 !== 0) return null;
  const normalized = value + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(normalized);
    if (btoa(binary).replace(/=+$/, "") !== value.replace(/=+$/, "")) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function demoTaskImageMimeType(data: Uint8Array): string | null {
  const has = (...signature: number[]): boolean =>
    signature.every((byte, index) => data[index] === byte);
  if (data.length >= 8 && has(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return "image/png";
  }
  if (data.length >= 3 && has(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (data.length >= 6) {
    const signature = String.fromCharCode(...data.subarray(0, 6));
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  if (
    data.length >= 12 &&
    String.fromCharCode(...data.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...data.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function validateDemoTaskImage(input: UploadTaskImageInput): { fileName: string; data: Uint8Array } {
  const fileName = input.fileName.trim();
  if (!fileName) throw new Error("File name is required");
  if (fileName.length > 255) throw new Error("File name must not exceed 255 characters");
  if ([...fileName].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  })) {
    throw new Error("File name contains control characters");
  }
  if (!DEMO_TASK_IMAGE_TYPES.has(input.mimeType)) {
    throw new Error("仅支持 PNG、JPEG、WebP 和 GIF 图片");
  }
  if (!input.dataBase64) throw new Error("Image data must not be empty");
  if (input.dataBase64.length > DEMO_TASK_IMAGE_MAX_BASE64_CHARACTERS) {
    throw new Error("Image must not exceed 5 MB");
  }
  const data = decodeDemoTaskImage(input.dataBase64);
  if (!data) throw new Error("Image data must be valid base64");
  if (data.length === 0) throw new Error("Image data must not be empty");
  if (data.length > DEMO_TASK_IMAGE_MAX_BYTES) throw new Error("Image must not exceed 5 MB");
  const detectedMimeType = demoTaskImageMimeType(data);
  if (detectedMimeType !== input.mimeType) {
    throw new Error(detectedMimeType
      ? `Declared MIME type does not match ${detectedMimeType}`
      : "Image data has an unsupported file signature");
  }
  return { fileName, data };
}

export function createDemoApi(): LifeOSApi {
  const store = loadStore();
  const taskImages: Array<TaskImage & Pick<UploadTaskImageInput, "dataBase64">> = [];

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
        scoreDimensions: input.scoreDimensions ?? null,
        score: input.scoreDimensions ? calculateCompositeScore(input.scoreDimensions) : 50,
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
      const knownIds = new Set(store.tasks.map((task) => task.id));
      if (
        new Set(orderedIds).size !== orderedIds.length ||
        orderedIds.length !== store.tasks.length ||
        orderedIds.some((id) => !knownIds.has(id))
      ) {
        throw new Error("排序必须包含全部任务");
      }
      const rank = new Map(orderedIds.map((id, index) => [id, index]));
      store.tasks = store.tasks.map((task) => {
        const next: Task = {
          ...task,
          rank: rank.get(task.id) ?? task.rank,
          version: task.version + 1,
          updatedAt: stamp(),
        };
        addEvent(next, "rank", task.rank, next.rank, "调整任务顺序");
        return next;
      });
      saveStore(store);
      return pause([...store.tasks].sort((left, right) => left.rank - right.rank), 120);
    },
    async getTaskEvents(id) {
      return pause(store.events[id] ?? [], 240);
    },
    async getTaskImages(taskId) {
      taskById(taskId);
      const items = taskImages
        .filter((image) => image.taskId === taskId)
        .map(({ id, taskId: ownerId, fileName, mimeType, sizeBytes, createdAt }) => ({
          id,
          taskId: ownerId,
          fileName,
          mimeType,
          sizeBytes,
          createdAt,
        }));
      return pause(items, 80);
    },
    async uploadTaskImage(taskId, input) {
      taskById(taskId);
      const validated = validateDemoTaskImage(input);
      if (taskImages.filter((image) => image.taskId === taskId).length >= DEMO_TASK_IMAGE_MAX_COUNT) {
        throw new Error("每个任务最多保存 20 张图片");
      }
      const image: TaskImage & Pick<UploadTaskImageInput, "dataBase64"> = {
        id: crypto.randomUUID(),
        taskId,
        fileName: validated.fileName,
        mimeType: input.mimeType,
        sizeBytes: validated.data.length,
        createdAt: stamp(),
        dataBase64: input.dataBase64,
      };
      taskImages.push(image);
      return pause<TaskImage>({
        id: image.id,
        taskId: image.taskId,
        fileName: image.fileName,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        createdAt: image.createdAt,
      }, 120);
    },
    getTaskImageContentUrl(taskId, imageId) {
      const image = taskImages.find((item) => item.taskId === taskId && item.id === imageId);
      return image ? `data:${image.mimeType};base64,${image.dataBase64}` : "";
    },
    async deleteTaskImage(taskId, imageId) {
      taskById(taskId);
      const index = taskImages.findIndex((image) => image.taskId === taskId && image.id === imageId);
      if (index < 0) throw new Error("图片不存在");
      taskImages.splice(index, 1);
      await pause(undefined, 80);
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
    async getCalendar(start, end) {
      return pause(projectCalendar(store.tasks, start, end));
    },
    async rescheduleTask(task, plannedDate) {
      return this.updateTask(task.id, task.version, { plannedDate });
    },
    async getGantt(start, end, goalId) {
      const ganttTasks = store.tasks
        .filter((task) => {
          if (goalId && task.goalId !== goalId) return false;
          const taskStart = task.startAt?.slice(0, 10) ?? task.plannedDate?.slice(0, 10);
          const taskEnd = task.endAt?.slice(0, 10) ?? task.deadline?.slice(0, 10) ?? taskStart;
          return Boolean(taskStart && taskEnd && taskStart <= end && taskEnd >= start);
        })
        .map((task) => ({
          ...task,
          progress: task.status === "completed" ? 100 : goalProgress(store.tasks, task.id).percent,
          isBlocked: store.dependencies.some((dependency) =>
            dependency.successorId === task.id &&
            taskById(dependency.predecessorId).status !== "completed"),
        }));
      const ids = new Set(ganttTasks.map((task) => task.id));
      const dependencies = store.dependencies.filter((item) =>
        ids.has(item.predecessorId) && ids.has(item.successorId));
      return pause({
        tasks: ganttTasks,
        dependencies,
        criticalPath: calculateCriticalPath(ganttTasks, dependencies),
      });
    },
    async updateTimespan(task, startAt, endAt) {
      return this.updateTask(task.id, task.version, { startAt, endAt });
    },
    async getGoals(status) {
      return pause(store.goals.filter((goal) => !goal.deletedAt && (!status || goal.status === status)));
    },
    async createGoal(input) {
      const goal: Goal = {
        id: crypto.randomUUID(),
        ...input,
        description: input.description ?? null,
        timeframe: input.timeframe ?? null,
        status: "active",
        rank: store.goals.length,
        createdAt: stamp(),
        updatedAt: stamp(),
        completedAt: null,
      };
      store.goals.push(goal);
      saveStore(store);
      return pause(goal);
    },
    async updateGoal(id, patch) {
      const current = store.goals.find((goal) => goal.id === id);
      if (!current) throw new Error("目标不存在");
      const next: Goal = {
        ...current,
        ...patch,
        updatedAt: stamp(),
        completedAt: patch.status === "completed" ? stamp() : current.completedAt,
      };
      store.goals = store.goals.map((goal) => goal.id === id ? next : goal);
      saveStore(store);
      return pause(next);
    },
    async deleteGoal(id) {
      store.goals = store.goals.map((goal) =>
        goal.id === id ? { ...goal, deletedAt: stamp(), updatedAt: stamp() } : goal);
      saveStore(store);
      await pause(undefined);
    },
    async getGoalTasks(id) {
      return pause(store.tasks.filter((task) => task.goalId === id));
    },
    async getGoalProgress(id) {
      return pause(goalProgress(store.tasks, id));
    },
    async getDependencies(id) {
      return pause(store.dependencies.filter((item) =>
        item.predecessorId === id || item.successorId === id));
    },
    async addDependency(id, predecessorId) {
      if (id === predecessorId) throw new Error("任务不能依赖自己");
      const dependency: TaskDependency = {
        id: crypto.randomUUID(),
        predecessorId,
        successorId: id,
        type: "finish_to_start",
        createdAt: stamp(),
      };
      store.dependencies.push(dependency);
      saveStore(store);
      return pause(dependency);
    },
    async deleteDependency(_taskId, dependencyId) {
      store.dependencies = store.dependencies.filter((item) => item.id !== dependencyId);
      saveStore(store);
      await pause(undefined);
    },
    async getSubtasks(id) {
      taskById(id);
      return pause(store.tasks
        .filter((task) => task.parentTaskId === id)
        .sort((left, right) => left.rank - right.rank));
    },
    async createSubtask(id, input) {
      const parent = taskById(id);
      const createdAt = stamp();
      const task: Task = {
        id: crypto.randomUUID(),
        version: 1,
        title: input.title.trim(),
        description: input.description ?? "",
        temperature: input.temperature,
        status: parent.status,
        hardness: input.deadline ? "hard" : "soft",
        deadline: input.deadline ?? null,
        plannedDate: input.plannedDate ?? null,
        parentTaskId: id,
        goalId: parent.goalId ?? null,
        tags: [...parent.tags],
        scoreDimensions: input.scoreDimensions ?? null,
        score: input.scoreDimensions ? calculateCompositeScore(input.scoreDimensions) : 50,
        rank: store.tasks.length,
        completedAt: parent.status === "completed" ? createdAt : null,
        createdAt,
        updatedAt: createdAt,
      };
      store.tasks.push(task);
      saveStore(store);
      return pause(task);
    },
    async reorderSubtasks(parentId, orderedIds) {
      taskById(parentId);
      const siblings = store.tasks
        .filter((task) => task.parentTaskId === parentId)
        .sort((left, right) => left.rank - right.rank);
      const siblingIds = new Set(siblings.map((task) => task.id));
      if (
        orderedIds.length !== siblings.length ||
        new Set(orderedIds).size !== orderedIds.length ||
        orderedIds.some((id) => !siblingIds.has(id))
      ) {
        throw new Error("排序必须且只能包含该父任务的全部直接子任务");
      }
      const rankSlots = siblings.map((task) => task.rank).sort((left, right) => left - right);
      const order = new Map(orderedIds.map((id, index) => [id, index]));
      store.tasks = store.tasks.map((task) => {
        const index = order.get(task.id);
        if (index === undefined) return task;
        const next: Task = {
          ...task,
          rank: rankSlots[index]!,
          version: task.version + 1,
          updatedAt: stamp(),
        };
        if (next.rank !== task.rank) addEvent(next, "rank", task.rank, next.rank, "调整子任务顺序");
        return next;
      });
      saveStore(store);
      const byId = new Map(store.tasks.map((task) => [task.id, task]));
      return pause(orderedIds.map((id) => byId.get(id)!), 120);
    },
    async getTaskProgress(id) {
      const children = store.tasks.filter((task) => task.parentTaskId === id);
      const completed = children.filter((task) => task.status === "completed").length;
      return pause({
        completed,
        total: children.length,
        percent: children.length ? Math.round(completed / children.length * 100) : 0,
      });
    },
    async getRepeatTemplates() {
      return pause(store.templates.filter((template) => template.enabled));
    },
    async createRepeatTemplate(input) {
      const template: RepeatTemplate = {
        id: crypto.randomUUID(),
        title: input.title,
        description: input.description ?? null,
        temperature: input.temperature ?? "warm",
        tags: input.tags ?? [],
        estimatedMinutes: input.estimatedMinutes ?? null,
        goalId: input.goalId ?? null,
        cronExpr: input.cronExpr,
        timezone: input.timezone ?? "Asia/Shanghai",
        horizonDays: input.horizonDays ?? 28,
        enabled: input.enabled ?? true,
        lastGenerated: null,
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      store.templates.push(template);
      saveStore(store);
      return pause(template);
    },
    async generateRepeatTemplate(id) {
      const template = store.templates.find((item) => item.id === id);
      if (!template) throw new Error("重复模板不存在");
      template.lastGenerated = localDate();
      template.updatedAt = stamp();
      saveStore(store);
      await pause(undefined);
    },
    async getMorning(date) {
      const previous = localDate(-1);
      return pause({
        unfinished: store.tasks.filter((task) =>
          task.plannedDate?.slice(0, 10) === previous && !["completed", "archived", "abandoned"].includes(task.status)),
        planned: store.tasks.filter((task) => task.plannedDate?.slice(0, 10) === date),
        deadlineToday: store.tasks.filter((task) => task.deadline?.slice(0, 10) === date),
      });
    },
    async carryover(date, decisions) {
      for (const decision of decisions) {
        const task = taskById(decision.taskId);
        task.version += 1;
        task.updatedAt = stamp();
        task.carryOverFrom = task.plannedDate?.slice(0, 10) ?? null;
        if (decision.action === "carry_today") task.plannedDate = date;
        if (decision.action === "reschedule") task.plannedDate = decision.targetDate ?? date;
        if (decision.action === "cool_down") task.temperature = "cold";
        if (decision.action === "abandon") task.status = "abandoned";
      }
      saveStore(store);
      return pause(store.tasks.filter((task) => decisions.some((item) => item.taskId === task.id)));
    },
    async getReviews(type, period) {
      return pause(store.reviews.filter((review) =>
        (!type || review.type === type) && (!period || review.periodStart <= period && review.periodEnd >= period)));
    },
    async createDailyPlan(date, plannedTaskIds, decisions) {
      const card: ReviewCard = {
        id: crypto.randomUUID(),
        type: "daily_plan",
        periodStart: date,
        periodEnd: date,
        content: {
          plannedTasks: store.tasks
            .filter((task) => plannedTaskIds.includes(task.id))
            .map((task) => ({ taskId: task.id, title: task.title })),
          carryoverDecisions: decisions,
        },
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      store.reviews = [card, ...store.reviews];
      saveStore(store);
      return pause(card);
    },
    async createDailyReview(date, content) {
      const card: ReviewCard = {
        id: crypto.randomUUID(),
        type: "daily_review",
        periodStart: date,
        periodEnd: date,
        content: { ...content },
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      store.reviews = [card, ...store.reviews];
      saveStore(store);
      return pause(card);
    },
    async generateReview(type, date) {
      const weekly = type === "weekly";
      const completedTasks = store.tasks.filter((task) => task.status === "completed");
      const dailyCompletionRates = Array.from({ length: 7 }, (_, index) => localDate(index - 6)).map((itemDate) => {
        const planned = store.tasks.filter((task) => task.plannedDate?.slice(0, 10) === itemDate);
        const completed = planned.filter((task) => task.status === "completed").length;
        return { date: itemDate, rate: planned.length ? Math.round(completed / planned.length * 100) : 0 };
      });
      const card: ReviewCard = {
        id: crypto.randomUUID(),
        type: weekly ? "weekly_review" : "monthly_review",
        periodStart: weekly ? localDate(-6) : `${date.slice(0, 7)}-01`,
        periodEnd: date,
        content: weekly
          ? {
              plannedCount: store.tasks.length,
              completedCount: completedTasks.length,
              completionRate: Math.round(completedTasks.length / Math.max(1, store.tasks.length) * 100),
              carriedTaskIds: store.tasks.filter((task) => task.carryOverFrom).map((task) => task.id),
              dailyCompletionRates,
              goals: store.goals.filter((goal) => goal.status === "active").map((goal) => ({
                goalId: goal.id,
                completedTaskIds: completedTasks.filter((task) => task.goalId === goal.id).map((task) => task.id),
              })),
            }
          : {
              taskCounts: {
                created: store.tasks.length,
                completed: completedTasks.length,
                abandoned: store.tasks.filter((task) => task.status === "abandoned").length,
              },
              repeatCompletionRate: 0,
              goals: store.goals.filter((goal) => goal.status === "active").map((goal) => ({
                goalId: goal.id,
                title: goal.title,
                monthCompleted: completedTasks.filter((task) => task.goalId === goal.id).length,
                ...goalProgress(store.tasks, goal.id),
              })),
            },
        createdAt: stamp(),
        updatedAt: stamp(),
      };
      store.reviews = [card, ...store.reviews];
      saveStore(store);
      return pause(card);
    },
  };
}
