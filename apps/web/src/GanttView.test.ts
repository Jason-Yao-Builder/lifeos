import { describe, expect, it } from "vitest";
import { ganttDragPreview, stableGanttTaskOrder } from "./GanttView";
import type { GanttTask } from "./types";
import { projectGanttTree } from "./v02-utils";

function task(id: string, rank: number, patch: Partial<GanttTask> = {}): GanttTask {
  return {
    id,
    version: 1,
    title: id,
    description: null,
    temperature: "warm",
    status: "todo",
    hardness: "soft",
    deadline: null,
    plannedDate: "2026-08-24",
    startAt: "2026-08-24",
    endAt: "2026-08-25",
    tags: [],
    score: null,
    rank,
    progress: 0,
    isBlocked: false,
    createdAt: `2026-08-24T00:00:0${rank}Z`,
    updatedAt: "2026-08-24T00:00:00Z",
    ...patch,
  };
}

describe("stableGanttTaskOrder", () => {
  it("keeps rank and previous tie order after a timespan reload", () => {
    const previous = [task("a", 0), task("b", 0), task("c", 2)];
    const response = [
      task("c", 2),
      task("b", 0, { startAt: "2026-09-02", endAt: "2026-09-05" }),
      task("a", 0),
    ];

    expect(stableGanttTaskOrder(response, previous).map(({ id }) => id)).toEqual(["a", "b", "c"]);
  });

  it("feeds the hierarchy a rank-stable order while preserving collapse", () => {
    const root = task("root", 0);
    const other = task("other", 1);
    const child = task("child", 2, { parentTaskId: root.id });
    const ordered = stableGanttTaskOrder([child, other, root]);

    expect(projectGanttTree(ordered, new Set()).map(({ task: item }) => item.id))
      .toEqual(["root", "child", "other"]);
    expect(projectGanttTree(ordered, new Set([root.id])).map(({ task: item }) => item.id))
      .toEqual(["root", "other"]);
  });
});

describe("ganttDragPreview", () => {
  it("previews move, start and end with the same target date used for commit", () => {
    const current = task("a", 0, { startAt: "2026-08-24", endAt: "2026-08-26" });

    expect(ganttDragPreview(current, 2, "2026-08-24", "2026-08-26", "move", "2026-08-24", "2026-08-26"))
      .toMatchObject({ startDate: "2026-08-26", endDate: "2026-08-28", dayCount: 3, label: "8/26 → 8/28 · 3天" });
    expect(ganttDragPreview(current, 2, "2026-08-24", "2026-08-26", "start", "2026-08-24", "2026-08-25"))
      .toMatchObject({ startDate: "2026-08-25", endDate: "2026-08-26", dayCount: 2 });
    expect(ganttDragPreview(current, 2, "2026-08-24", "2026-08-26", "end", "2026-08-26", "2026-08-29"))
      .toMatchObject({ startDate: "2026-08-24", endDate: "2026-08-29", dayCount: 6 });
  });

  it("clamps inverted edge changes and never previews a blocked task or invalid target", () => {
    const current = task("a", 0, { startAt: "2026-08-24", endAt: "2026-08-26" });
    const blocked = task("blocked", 1, { isBlocked: true });

    expect(ganttDragPreview(current, 0, "2026-08-24", "2026-08-26", "start", "2026-08-24", "2026-08-30"))
      .toMatchObject({ startDate: "2026-08-26", endDate: "2026-08-26", dayCount: 1 });
    expect(ganttDragPreview(current, 0, "2026-08-24", "2026-08-26", "end", "2026-08-26", "2026-08-20"))
      .toMatchObject({ startDate: "2026-08-24", endDate: "2026-08-24", dayCount: 1 });
    expect(ganttDragPreview(blocked, 0, "2026-08-24", "2026-08-26", "move", "2026-08-24", "2026-08-25")).toBeNull();
    expect(ganttDragPreview(current, 0, "2026-08-24", "2026-08-26", "move", "2026-08-24", null)).toBeNull();
  });
});
