import type { CardType, TaskStatus, Temperature } from "./types";

export const temperatureLabels: Record<Temperature, string> = {
  hot: "热",
  warm: "温",
  cold: "冷",
  inspiration: "灵感",
};

export const statusLabels: Record<TaskStatus, string> = {
  todo: "未开始",
  in_progress: "进行中",
  completed: "已完成",
  archived: "已归档",
  abandoned: "已放弃",
};

export const statusTransitions: Record<TaskStatus, TaskStatus[]> = {
  todo: ["in_progress"],
  in_progress: ["completed", "abandoned"],
  completed: ["todo", "archived"],
  abandoned: ["archived"],
  archived: ["todo"],
};

export const cardTypeLabels: Record<CardType, string> = {
  action: "行动建议",
  observation: "模式观察",
  generation: "AI 生成",
};

export function todayKey(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export function openDatePicker(input: HTMLInputElement): void {
  input.focus();
  try {
    input.showPicker?.();
  } catch {
    // Browsers without a programmatic picker still keep the native input usable.
  }
}

export function mergeTags(current: string[], raw: string): string[] {
  const next = [...current];
  for (const value of raw.split(/[,，]/)) {
    const tag = value.trim().slice(0, 50);
    if (tag && !next.includes(tag) && next.length < 50) next.push(tag);
  }
  return next;
}

export function formatLongDate(value = new Date()): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(value);
}

export function formatShortDate(value: string | null): string {
  if (!value) return "未设置";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
  }).format(date);
}

export function relativeTime(value: string): string {
  const distance = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(distance / 60_000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export function readableValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "未设置";
  if (Array.isArray(value)) return value.join("、") || "无";
  if (typeof value === "boolean") return value ? "开启" : "关闭";
  if (typeof value === "string") {
    if (value in temperatureLabels)
      return temperatureLabels[value as Temperature];
    if (value in statusLabels) return statusLabels[value as TaskStatus];
  }
  return String(value);
}
