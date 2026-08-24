import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildQuickTaskInput,
  createScoreDimensionDraft,
  normalizeScoreDimensionDraft,
  parseScoreDimensionDraftValue,
  TaskBoard,
} from "./TaskBoard";
import type { Task } from "./types";
import { calculateCompositeScore, todayKey } from "./utils";

const unscoredTask: Task = {
  id: "task-unscored",
  version: 1,
  title: "未评分任务",
  description: null,
  temperature: "warm",
  status: "todo",
  hardness: "soft",
  deadline: null,
  plannedDate: null,
  tags: [],
  scoreDimensions: null,
  score: null,
  rank: 0,
  createdAt: "2026-08-24T08:00:00.000Z",
  updatedAt: "2026-08-24T08:00:00.000Z",
};

function renderBoard(tasks: Task[], view: "tasks" | "today" = "today"): string {
  return renderToStaticMarkup(
    <TaskBoard
      view={view}
      tasks={tasks}
      filters={{ temperature: "all", status: "all", tag: "", time: "current" }}
      tags={[]}
      onViewChange={() => undefined}
      onFiltersChange={() => undefined}
      onAdd={async () => undefined}
      onUpdate={async () => undefined}
      onOpen={() => undefined}
      onReorder={async () => undefined}
    />,
  );
}

describe("TaskBoard score control", () => {
  it("keeps an emptied score field blank so retyping 30 does not produce 030", () => {
    const initial = createScoreDimensionDraft({
      impact: 50,
      urgency: 60,
      alignment: 70,
      effort: 80,
    });
    const emptied = { ...initial, impact: parseScoreDimensionDraftValue("", Number.NaN) };
    const retyped = { ...emptied, impact: parseScoreDimensionDraftValue("30", 30) };

    expect(emptied.impact).toBe("");
    expect(retyped.impact).toBe(30);
    expect(normalizeScoreDimensionDraft(emptied)).toBeNull();
    expect(calculateCompositeScore(normalizeScoreDimensionDraft(retyped)!)).toBe(50.5);
  });

  it("clamps non-empty draft values to numeric 0–100 dimensions", () => {
    const normalized = normalizeScoreDimensionDraft({
      impact: parseScoreDimensionDraftValue("25", 25),
      urgency: parseScoreDimensionDraftValue("125", 125),
      alignment: parseScoreDimensionDraftValue("-4", -4),
      effort: parseScoreDimensionDraftValue("35.5", 35.5),
    });

    expect(normalized).toEqual({ impact: 25, urgency: 100, alignment: 0, effort: 35.5 });
    expect(Object.values(normalized ?? {}).every((value) => typeof value === "number")).toBe(true);
  });

  it("renders an Enter-only multi-tag entry in the basic quick-create card", () => {
    const html = renderBoard([]);

    expect(html).toContain('aria-label="新任务标签"');
    expect(html).toContain('aria-label="添加新任务标签"');
    expect(html).toContain("输入标签后按 Enter 添加");
    const quickTagEntry = html.match(/<div class="quick-tag-entry">([\s\S]*?)<\/div>/)?.[1] ?? "";
    expect(quickTagEntry).not.toContain("<button");
    expect(html).toContain("0/50");
  });

  it("renders a null score as an accessible manual-score button", () => {
    const html = renderBoard([unscoredTask]);

    expect(html).toMatch(/<button[^>]*class="score score-button"[^>]*>—<\/button>/);
    expect(html).toContain("未评分任务的综合分未生成，点击人工调整");
    expect(html).toContain('aria-expanded="false"');
  });

  it("renders grouped tasks in rank order even when children belong to different parents", () => {
    const rootA = { ...unscoredTask, id: "root-a", title: "Root A", rank: 0 };
    const childA = {
      ...unscoredTask,
      id: "child-a",
      title: "Child A",
      parentTaskId: rootA.id,
      rank: 2,
    };
    const rootB = { ...unscoredTask, id: "root-b", title: "Root B", rank: 3 };
    const childB = {
      ...unscoredTask,
      id: "child-b",
      title: "Child B",
      parentTaskId: rootB.id,
      rank: 1,
    };
    const html = renderBoard([childA, rootB, rootA, childB], "tasks");
    const renderedIds = [...html.matchAll(/data-task-drop-id="([^"]+)"/g)]
      .map((match) => match[1]);

    expect(renderedIds).toEqual([rootA.id, childB.id, childA.id, rootB.id]);
    expect(childA.parentTaskId).toBe(rootA.id);
    expect(childB.parentTaskId).toBe(rootB.id);
  });

  it("renders the child toggle as a separate accessible control after the summary", () => {
    const parent = { ...unscoredTask, id: "parent", title: "父任务", rank: 0 };
    const child = {
      ...unscoredTask,
      id: "child",
      title: "子任务",
      parentTaskId: parent.id,
      rank: 1,
    };
    const html = renderBoard([parent, child], "tasks");
    const parentMarkup = html.match(
      /<article[^>]*data-task-drop-id="parent"[\s\S]*?<\/article>/,
    )?.[0] ?? "";
    const summaryStart = parentMarkup.indexOf('class="task-summary"');
    const summaryEnd = parentMarkup.indexOf("</button>", summaryStart);
    const toggleStart = parentMarkup.indexOf('class="task-children-toggle"');

    expect(parentMarkup).toContain('aria-label="收起父任务的子任务"');
    expect(parentMarkup).toContain('aria-expanded="true"');
    expect(parentMarkup).toContain('draggable="false"');
    expect(summaryStart).toBeGreaterThan(-1);
    expect(summaryEnd).toBeLessThan(toggleStart);
  });
});

describe("TaskBoard quick-create payload", () => {
  it.each([
    ["tasks", null],
    ["today", todayKey()],
  ] as const)("includes the description without changing tags or manual scoring in %s", (view, plannedDate) => {
    const scoreDimensions = { impact: 80, urgency: 70, alignment: 60, effort: 40 };

    expect(buildQuickTaskInput(view, {
      title: "  新任务  ",
      description: "  背景与完成标准  ",
      temperature: "warm",
      deadline: "2026-08-31",
      tags: ["既有标签"],
      tagInput: "尾标签",
      manualScore: true,
      scoreDimensions,
    })).toEqual({
      title: "新任务",
      description: "背景与完成标准",
      temperature: "warm",
      deadline: "2026-08-31",
      plannedDate,
      tags: ["既有标签", "尾标签"],
      scoreDimensions,
    });
  });

  it("keeps automatic scoring implicit", () => {
    const input = buildQuickTaskInput("tasks", {
      title: "新任务",
      description: "",
      temperature: "cold",
      deadline: "",
      tags: [],
      tagInput: "",
      manualScore: false,
      scoreDimensions: { impact: 50, urgency: 50, alignment: 50, effort: 50 },
    });

    expect(input).toMatchObject({ description: "", tags: [], deadline: null });
    expect(input).not.toHaveProperty("scoreDimensions");
  });

  it("keeps a completed manual draft numeric in the create payload", () => {
    const scoreDimensions = normalizeScoreDimensionDraft({
      impact: parseScoreDimensionDraftValue("25", 25),
      urgency: parseScoreDimensionDraftValue("120", 120),
      alignment: parseScoreDimensionDraftValue("30", 30),
      effort: parseScoreDimensionDraftValue("-5", -5),
    });
    expect(scoreDimensions).not.toBeNull();
    const input = buildQuickTaskInput("tasks", {
      title: "手动评分任务",
      description: "",
      temperature: "warm",
      deadline: "",
      tags: [],
      tagInput: "",
      manualScore: true,
      scoreDimensions: scoreDimensions!,
    });

    expect(input.scoreDimensions).toEqual({ impact: 25, urgency: 100, alignment: 30, effort: 0 });
    expect(Object.values(input.scoreDimensions ?? {}).every((value) => typeof value === "number"))
      .toBe(true);
  });
});
