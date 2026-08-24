import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ganttColorName,
  ganttDragPreview,
  ganttGroupGradient,
  ganttGroupAccessibleLabel,
  ganttPreviewAppearance,
  ganttTaskAppearance,
  loadGanttSnapshot,
  stableGanttTaskOrder,
  GanttView,
} from "./GanttView";
import type { LifeOSApi } from "./api";
import type { GanttTask, TaskGroup } from "./types";
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
    groupId: null,
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

const productGroup: TaskGroup = {
  id: "group-product",
  workspaceId: "local-workspace",
  name: "产品",
  color: "#336699",
  createdAt: "2026-08-24T00:00:00Z",
  updatedAt: "2026-08-24T00:00:00Z",
};

describe("GanttView navigation", () => {
  it("renders the shared Views heading and selects the Gantt tab", () => {
    const markup = renderToStaticMarkup(createElement(GanttView, {
      api: {} as LifeOSApi,
      goals: [],
      taskRevision: "0",
      onOpen: vi.fn(),
      onTaskSaved: vi.fn(),
      onToast: vi.fn(),
    }));

    expect(markup).toContain('<h1 id="task-views-title">视图</h1>');
    expect(markup).toContain('id="task-view-panel-gantt"');
    expect(markup).toContain('id="task-view-tab-gantt"');
    expect(markup).toContain('aria-selected="true"');
  });
});

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

describe("Gantt group colors", () => {
  it("uses a group-colored progress gradient for the bar instead of its temperature fill", () => {
    const grouped = ganttTaskAppearance(
      task("grouped", 0, { groupId: productGroup.id, temperature: "hot", progress: 40 }),
      [productGroup],
    );

    expect(grouped.className).not.toContain("temperature-hot");
    expect(grouped.className).toContain("gantt-group-colored");
    expect(grouped.style).toMatchObject({
      "--task-group-color": "#336699",
      "--task-group-fill": "#cedae7",
      "--task-group-progress": "40%",
      "--task-group-gradient": "linear-gradient(90deg, #336699 0%, #336699 40%, #cedae7 40%, #cedae7 100%)",
      background: "linear-gradient(90deg, #336699 0%, #336699 40%, #cedae7 40%, #cedae7 100%)",
    });
  });

  it("clamps progress stops so malformed progress cannot break the group gradient", () => {
    expect(ganttGroupGradient(productGroup.color, -20))
      .toBe("linear-gradient(90deg, #336699 0%, #336699 0%, #cedae7 0%, #cedae7 100%)");
    expect(ganttGroupGradient(productGroup.color, 140))
      .toBe("linear-gradient(90deg, #336699 0%, #336699 100%, #cedae7 100%, #cedae7 100%)");
  });

  it("keeps temperature colors as the fallback for ungrouped and unresolved groups", () => {
    const ungrouped = ganttTaskAppearance(task("ungrouped", 1, { temperature: "cold" }), [productGroup]);
    const missingGroup = ganttTaskAppearance(
      task("missing-group", 2, { groupId: "unknown", temperature: "inspiration" }),
      [productGroup],
    );

    expect(ungrouped.className).toContain("temperature-cold");
    expect(ungrouped.className).not.toContain("gantt-group-colored");
    expect(ungrouped.style).not.toHaveProperty("--task-group-color");
    expect(missingGroup.className).toContain("temperature-inspiration");
    expect(missingGroup.group).toBeNull();
  });

  it("uses the same group variables for bars and drag ghosts without dropping state classes", () => {
    const current = task("critical", 0, { groupId: productGroup.id, progress: 65 });
    const blocked = task("blocked-critical", 1, {
      groupId: productGroup.id,
      isBlocked: true,
    });
    const bar = ganttTaskAppearance(blocked, [productGroup], { critical: true });
    const ghost = ganttPreviewAppearance(current, [productGroup], new Set([current.id]));
    const temperatureGhost = ganttTaskAppearance(task("plain", 2, { temperature: "warm" }), [], { preview: true });

    expect(bar.className).toContain("is-critical");
    expect(bar.className).toContain("is-blocked");
    expect(bar.style["--task-group-color"]).toBe("#336699");
    expect(bar.style).not.toHaveProperty("borderColor");
    expect(ghost.className).toContain("gantt-drag-preview");
    expect(ghost.className).toContain("gantt-group-colored");
    expect(ghost.className).toContain("is-critical");
    expect(ghost.className).not.toContain("is-blocked");
    expect(ghost.style["--task-group-color"]).toBe(bar.style["--task-group-color"]);
    expect(ghost.style.background).toBe(ganttGroupGradient(productGroup.color, 65));
    expect(temperatureGhost.style).toMatchObject({
      "--gantt-preview-fill": "#f2dfb4",
      "--gantt-preview-border": "#af873d",
    });
    expect(temperatureGhost.style).not.toHaveProperty("borderColor");
  });

  it("preserves parent and child group colors through tree projection and collapse", () => {
    const parent = task("parent", 0, { groupId: productGroup.id });
    const child = task("child", 1, { parentTaskId: parent.id, groupId: productGroup.id });
    const expanded = projectGanttTree([parent, child], new Set());
    const collapsed = projectGanttTree([parent, child], new Set([parent.id]));

    expect(expanded.map(({ task: item }) =>
      ganttTaskAppearance(item, [productGroup]).style["--task-group-color"])).toEqual([
      "#336699",
      "#336699",
    ]);
    expect(collapsed.map(({ task: item }) => item.id)).toEqual([parent.id]);
  });

  it("gives arbitrary hex colors an accessible Chinese name", () => {
    expect(ganttColorName(productGroup.color)).toBe("蓝色");
    expect(ganttGroupAccessibleLabel(productGroup)).toBe("产品，蓝色（#336699）");
  });

  it("keeps a successful gantt response when the optional group list is unavailable", async () => {
    const current = task("scheduled", 0, { groupId: "missing-group" });
    const loaded = await loadGanttSnapshot({
      getGantt: async () => ({ tasks: [current], dependencies: [], criticalPath: [] }),
      getTaskGroups: async () => { throw new Error("404 task groups unavailable"); },
    }, "2026-08-24", "2026-09-30", undefined);

    expect(loaded.data.tasks).toEqual([current]);
    expect(loaded.groups).toEqual([]);
  });

  it("starts the gantt and group requests together", async () => {
    const calls: string[] = [];
    let resolveGantt!: (value: { tasks: GanttTask[]; dependencies: []; criticalPath: [] }) => void;
    const gantt = new Promise<{ tasks: GanttTask[]; dependencies: []; criticalPath: [] }>((resolve) => {
      resolveGantt = resolve;
    });
    const pending = loadGanttSnapshot({
      getGantt: () => {
        calls.push("gantt");
        return gantt;
      },
      getTaskGroups: async () => {
        calls.push("groups");
        return [productGroup];
      },
    }, "2026-08-24", "2026-09-30", undefined);

    expect(calls).toEqual(["gantt", "groups"]);
    resolveGantt({ tasks: [], dependencies: [], criticalPath: [] });
    await expect(pending).resolves.toMatchObject({ groups: [productGroup] });
  });
});
