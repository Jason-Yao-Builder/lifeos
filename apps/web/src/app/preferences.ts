const rollForwardDateKey = "lifeos.rollForwardTargetDate";
const taskEditorPlaceholdersKey = "lifeos.taskEditorPlaceholders";

export type TaskEditorPlaceholderKey = "title" | "description" | "tags";

export interface TaskEditorPlaceholderOption {
  enabled: boolean;
  text: string;
}

export type TaskEditorPlaceholders = Record<
  TaskEditorPlaceholderKey,
  TaskEditorPlaceholderOption
>;

export const defaultTaskEditorPlaceholders: TaskEditorPlaceholders = {
  title: { enabled: true, text: "任务名称" },
  description: { enabled: true, text: "描述" },
  tags: {
    enabled: true,
    text: "标签，逗号分隔。例如：个人成长，工作，编程",
  },
};

export function loadTaskEditorPlaceholders(
  storage?: Pick<Storage, "getItem">,
): TaskEditorPlaceholders {
  const raw = storage?.getItem(taskEditorPlaceholdersKey);
  if (!raw) return structuredClone(defaultTaskEditorPlaceholders);
  try {
    const saved = JSON.parse(raw) as Partial<TaskEditorPlaceholders>;
    return Object.fromEntries(
      (Object.keys(defaultTaskEditorPlaceholders) as TaskEditorPlaceholderKey[]).map((key) => {
        const fallback = defaultTaskEditorPlaceholders[key];
        const candidate = saved[key];
        return [key, {
          enabled: typeof candidate?.enabled === "boolean" ? candidate.enabled : fallback.enabled,
          text: typeof candidate?.text === "string" ? candidate.text.slice(0, 120) : fallback.text,
        }];
      }),
    ) as TaskEditorPlaceholders;
  } catch {
    return structuredClone(defaultTaskEditorPlaceholders);
  }
}

export function saveTaskEditorPlaceholders(
  value: TaskEditorPlaceholders,
  storage: Pick<Storage, "setItem">,
): void {
  storage.setItem(taskEditorPlaceholdersKey, JSON.stringify(value));
}

export function validRollForwardDate(value: string | null, today: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= today ? value : today;
}

export function loadRollForwardDate(
  today: string,
  storage?: Pick<Storage, "getItem">,
): string {
  return validRollForwardDate(storage?.getItem(rollForwardDateKey) ?? null, today);
}

export function saveRollForwardDate(value: string, storage: Pick<Storage, "setItem">): void {
  storage.setItem(rollForwardDateKey, value);
}
