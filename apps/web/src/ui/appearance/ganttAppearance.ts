import type { CSSProperties } from "react";
import type { GanttTask, TaskGroup, Temperature } from "../../types";

export type GanttColorStyle = CSSProperties & {
  "--task-group-color"?: string;
  "--task-group-fill"?: string;
  "--task-group-gradient"?: string;
  "--task-group-progress"?: string;
  "--gantt-preview-fill"?: string;
  "--gantt-preview-border"?: string;
};

const temperatureFills: Record<Temperature, string> = {
  hot: "#f3cfc9",
  warm: "#f2dfb4",
  cold: "#d7e6ed",
  inspiration: "#e5dcef",
};

const temperatureBorders: Record<Temperature, string> = {
  hot: "#c87869",
  warm: "#af873d",
  cold: "#7197a8",
  inspiration: "#9276a9",
};

export function lightGroupFill(color: string): string {
  const channels = [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
  return `#${channels.map((channel) =>
    Math.round(channel + (255 - channel) * 0.76).toString(16).padStart(2, "0"),
  ).join("")}`;
}

export function clampedProgress(progress: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
}

export function ganttGroupGradient(color: string, progress: number): string {
  const fill = lightGroupFill(color);
  const stop = clampedProgress(progress);
  return `linear-gradient(90deg, ${color} 0%, ${color} ${stop}%, ${fill} ${stop}%, ${fill} 100%)`;
}

export function ganttColorName(color: string): string {
  const red = Number.parseInt(color.slice(1, 3), 16) / 255;
  const green = Number.parseInt(color.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const lightness = (maximum + minimum) / 2;
  const delta = maximum - minimum;
  if (lightness > 0.93) return "白色";
  if (lightness < 0.12) return "黑色";
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.15) return "灰色";
  const hue = maximum === red
    ? 60 * (((green - blue) / delta) % 6)
    : maximum === green
      ? 60 * ((blue - red) / delta + 2)
      : 60 * ((red - green) / delta + 4);
  const normalizedHue = hue < 0 ? hue + 360 : hue;
  if (normalizedHue < 15 || normalizedHue >= 345) return "红色";
  if (normalizedHue < 45) return "橙色";
  if (normalizedHue < 70) return "黄色";
  if (normalizedHue < 165) return "绿色";
  if (normalizedHue < 195) return "青色";
  if (normalizedHue < 255) return "蓝色";
  if (normalizedHue < 290) return "紫色";
  return "粉色";
}

export function ganttGroupAccessibleLabel(group: Pick<TaskGroup, "name" | "color">): string {
  return `${group.name}，${ganttColorName(group.color)}（${group.color.toUpperCase()}）`;
}

export function ganttTaskAppearance(
  task: Pick<GanttTask, "groupId" | "temperature" | "progress" | "isBlocked">,
  groups: readonly TaskGroup[],
  options: { preview?: boolean; critical?: boolean } = {},
): { className: string; style: GanttColorStyle; group: TaskGroup | null } {
  const group = task.groupId ? groups.find((candidate) => candidate.id === task.groupId) ?? null : null;
  const className = [
    options.preview ? "gantt-drag-preview" : "gantt-bar",
    group ? "" : `temperature-${task.temperature}`,
    group ? "gantt-group-colored" : "",
    options.critical ? "is-critical" : "",
    task.isBlocked ? "is-blocked" : "",
  ].filter(Boolean).join(" ");
  const progress = clampedProgress(task.progress);
  const gradient = group ? ganttGroupGradient(group.color, progress) : "";
  const style: GanttColorStyle = group
    ? {
        "--task-group-color": group.color,
        "--task-group-fill": lightGroupFill(group.color),
        "--task-group-gradient": gradient,
        "--task-group-progress": `${progress}%`,
        background: gradient,
      }
    : options.preview
      ? {
          "--gantt-preview-fill": temperatureFills[task.temperature],
          "--gantt-preview-border": temperatureBorders[task.temperature],
        }
      : {};
  return { className, style, group };
}

export function ganttPreviewAppearance(
  task: Pick<GanttTask, "id" | "groupId" | "temperature" | "progress" | "isBlocked">,
  groups: readonly TaskGroup[],
  criticalTaskIds: ReadonlySet<string>,
) {
  return ganttTaskAppearance(task, groups, {
    preview: true,
    critical: criticalTaskIds.has(task.id),
  });
}
