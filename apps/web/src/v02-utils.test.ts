import { describe, expect, it } from "vitest";
import type { GanttTask, Task, TaskDependency } from "./types";
import {
  addDays,
  addMonths,
  calendarAnchorForMonth,
  calculateCriticalPath,
  carryoverDecisionsFromDrafts,
  dateAtHorizontalPointer,
  dateRange,
  dailyReviewTasks,
  dayDifference,
  deadlineLevel,
  hierarchyDepth,
  matchesTagKeyword,
  matchesTaskTimeFilter,
  mergeScopedOrder,
  monthlyGoalReviewRows,
  monthGrid,
  monthTimelineSegments,
  monthTimelineWindow,
  moveTimespan,
  projectCalendar,
  passedPointerDragThreshold,
  projectGanttTree,
  reorderTaskIds,
  stepCalendarAnchor,
  startOfWeek,
  taskDropPosition,
  taskHierarchyReorderAnchor,
  taskRowsByRank,
  taskTreeRows,
  taskCompletionRate,
  taskQueueGroup,
  taskTargetDate,
  weeklyCompletionTrend,
  weeklyGoalAggregates,
  visibleTaskTreeRows,
} from "./v02-utils";

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id,
  version: 1,
  title: id,
  description: null,
  temperature: "warm",
  status: "todo",
  hardness: "soft",
  deadline: null,
  plannedDate: null,
  groupId: null,
  tags: [],
  score: null,
  rank: 0,
  createdAt: "2026-08-01T00:00:00+08:00",
  updatedAt: "2026-08-01T00:00:00+08:00",
  ...patch,
});

describe("task time filters and queue groups", () => {
  const today = "2026-08-24";

  it("converts deadline instants into the browser's local date before plannedDate", () => {
    expect(taskTargetDate(task("deadline", {
      deadline: "2026-08-23T17:00:00Z",
      plannedDate: "2026-08-23",
    }))).toBe("2026-08-24");
    expect(taskTargetDate(task("planned", { plannedDate: "2026-08-25" }))).toBe("2026-08-25");
    expect(taskTargetDate(task("invalid-instant", {
      deadline: "2026-08-26-invalid",
      plannedDate: "2026-08-25",
    }))).toBe("2026-08-26");
    expect(taskTargetDate(task("unscheduled"))).toBeNull();
  });

  it("keeps only active work and today's completion facts in current", () => {
    const tasks = [
      task("todo"),
      task("in-progress", { status: "in_progress" }),
      task("completed-today", { status: "completed", completedAt: "2026-08-23T17:00:00Z" }),
      task("archived-today", { status: "archived", completedAt: "2026-08-24T15:59:59Z" }),
      task("completed-yesterday", { status: "completed", completedAt: "2026-08-23T23:59:59+08:00" }),
      task("completed-without-fact", { status: "completed" }),
      task("abandoned", { status: "abandoned" }),
    ];
    expect(tasks.filter((item) => matchesTaskTimeFilter(item, "current", today)).map(({ id }) => id))
      .toEqual(["todo", "in-progress", "completed-today", "archived-today"]);
    expect(tasks.every((item) => matchesTaskTimeFilter(item, "all", today))).toBe(true);
  });

  it("keeps target filters independent from completion filters", () => {
    const completed = task("completed", {
      status: "archived",
      deadline: "2026-08-24T18:00:00+08:00",
      plannedDate: "2026-08-26",
      completedAt: "2026-08-23T18:00:00+08:00",
    });
    expect(matchesTaskTimeFilter(completed, "target_today", today)).toBe(true);
    expect(matchesTaskTimeFilter(completed, "target_future", today)).toBe(false);
    expect(matchesTaskTimeFilter(completed, "completed_today", today)).toBe(false);
    expect(matchesTaskTimeFilter(completed, "completed_past", today)).toBe(true);
    expect(matchesTaskTimeFilter(task("past", { plannedDate: "2026-08-23" }), "target_past", today)).toBe(true);
    expect(matchesTaskTimeFilter(task("future", { plannedDate: "2026-08-25" }), "target_future", today)).toBe(true);
    expect(matchesTaskTimeFilter(task("none"), "target_today", today)).toBe(false);
  });

  it("groups active targets, completion facts, and other terminal states separately", () => {
    const cases: Array<[Task, string]> = [
      [task("overdue", { deadline: "2026-08-23T15:59:59Z", plannedDate: "2026-08-30" }), "overdue"],
      [task("due-today", { plannedDate: today }), "due_today"],
      [task("future", { deadline: "2026-08-24T16:00:00Z" }), "future"],
      [task("unscheduled"), "unscheduled"],
      [task("completed-today", { status: "archived", plannedDate: "2026-08-20", completedAt: "2026-08-23T17:00:00Z" }), "completed_today"],
      [task("completed-past", { status: "completed", plannedDate: today, completedAt: "2026-08-23T15:59:59Z" }), "completed_past"],
      [task("abandoned", { status: "abandoned", plannedDate: today }), "other_terminal"],
      [task("completed-without-fact", { status: "completed" }), "other_terminal"],
      [task("future-completion", { status: "archived", completedAt: "2026-08-25T00:00:00+08:00" }), "other_terminal"],
    ];
    expect(cases.map(([item]) => taskQueueGroup(item, today))).toEqual(cases.map(([, group]) => group));
    expect(matchesTaskTimeFilter(cases[5]![0], "current", today)).toBe(false);
    expect(matchesTaskTimeFilter(cases[4]![0], "current", today)).toBe(true);
  });
});

describe("tag keyword matching", () => {
  it("matches trimmed case-insensitive substrings and treats blank as all tags", () => {
    const tags = ["PersonalGrowth", "产品规划", "Deep-Work"];
    expect(matchesTagKeyword(tags, " growth ")).toBe(true);
    expect(matchesTagKeyword(tags, "DEEP")).toBe(true);
    expect(matchesTagKeyword(tags, "品规")).toBe(true);
    expect(matchesTagKeyword(tags, "meeting")).toBe(false);
    expect(matchesTagKeyword(tags, "   ")).toBe(true);
  });
});

describe("v0.2 calendar and gantt helpers", () => {
  it("jumps to a selected month with mode-aware day semantics", () => {
    expect(calendarAnchorForMonth("2026-01-31", "2026-02", "month")).toBe("2026-02-01");
    const weekAnchor = calendarAnchorForMonth("2026-01-31", "2026-02", "week");
    expect(weekAnchor).toBe("2026-02-28");
    expect(dateRange(startOfWeek(weekAnchor!), addDays(startOfWeek(weekAnchor!), 6)))
      .toEqual(["2026-02-23", "2026-02-24", "2026-02-25", "2026-02-26", "2026-02-27", "2026-02-28", "2026-03-01"]);
    expect(calendarAnchorForMonth("2024-01-31", "2024-02", "day")).toBe("2024-02-29");
    expect(calendarAnchorForMonth("2026-08-24", "2026-08", "day")).toBe("2026-08-24");
    expect(calendarAnchorForMonth("2026-08-24", "2027-01", "day")).toBe("2027-01-24");
    expect(calendarAnchorForMonth("2026-08-24", "2026-13", "day")).toBeNull();
    expect(calendarAnchorForMonth("invalid", "2026-08", "month")).toBeNull();
  });

  it("steps calendar arrows by the active view without UTC date drift", () => {
    expect(stepCalendarAnchor("2026-12-31", "month", 1)).toBe("2027-01-01");
    expect(stepCalendarAnchor("2024-02-26", "week", 1)).toBe("2024-03-04");
    expect(stepCalendarAnchor("2024-03-01", "day", -1)).toBe("2024-02-29");
  });

  it("starts touch dragging only after a deliberate move and resolves a clamped date", () => {
    expect(passedPointerDragThreshold(10, 10, 15, 15)).toBe(false);
    expect(passedPointerDragThreshold(10, 10, 19, 10)).toBe(true);
    const dates = ["2026-08-24", "2026-08-25", "2026-08-26"];
    expect(dateAtHorizontalPointer(135, 100, 30, dates)).toBe("2026-08-25");
    expect(dateAtHorizontalPointer(10, 100, 30, dates)).toBe("2026-08-24");
    expect(dateAtHorizontalPointer(999, 100, 30, dates)).toBe("2026-08-26");
  });

  it("builds a stable 6×7 month grid", () => {
    const days = monthGrid("2026-08-24");
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2026-07-27");
    expect(days[41]).toBe("2026-09-06");
  });

  it("groups a cross-month timeline into full natural-month segments", () => {
    const window = monthTimelineWindow("2026-01-30", 32);
    expect(window).toEqual({ start: "2026-01-01", end: "2026-03-31" });
    const days = dateRange(window.start, window.end);
    const segments = monthTimelineSegments(days);
    expect(segments).toEqual([
      {
        month: "2026-01", start: "2026-01-01", end: "2026-01-31",
        offsetDays: 0, dayCount: 31, label: "2026年1月",
      },
      {
        month: "2026-02", start: "2026-02-01", end: "2026-02-28",
        offsetDays: 31, dayCount: 28, label: "2月",
      },
      {
        month: "2026-03", start: "2026-03-01", end: "2026-03-31",
        offsetDays: 59, dayCount: 31, label: "3月",
      },
    ]);
    expect(segments.reduce((total, segment) => total + segment.dayCount, 0)).toBe(days.length);
  });

  it("keeps leap-day and year-boundary month widths exact", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2024-03-31", -1)).toBe("2024-02-29");
    expect(addMonths("2026-12-31", 1)).toBe("2027-01-31");
    const leapWindow = monthTimelineWindow("2024-02-29", 0);
    const leap = monthTimelineSegments(dateRange(leapWindow.start, leapWindow.end));
    expect(leap).toEqual([expect.objectContaining({
      month: "2024-02", start: "2024-02-01", end: "2024-02-29", dayCount: 29,
    })]);

    const yearWindow = monthTimelineWindow("2026-12-31", 1);
    const yearBoundary = monthTimelineSegments(dateRange(yearWindow.start, yearWindow.end));
    expect(yearBoundary.map(({ month, dayCount, label }) => ({ month, dayCount, label }))).toEqual([
      { month: "2026-12", dayCount: 31, label: "2026年12月" },
      { month: "2027-01", dayCount: 31, label: "2027年1月" },
    ]);
  });

  it("projects planned, deadline and repeat tasks without duplication", () => {
    const data = projectCalendar([
      task("planned", { plannedDate: "2026-08-24", deadline: "2026-08-26T12:00:00+08:00" }),
      task("repeat", { plannedDate: "2026-08-25", repeatTemplateId: "tpl" }),
    ], "2026-08-24", "2026-08-26");
    expect(data.days["2026-08-24"]?.tasks.map(({ id }) => id)).toEqual(["planned"]);
    expect(data.days["2026-08-26"]?.deadlineTasks.map(({ id }) => id)).toEqual(["planned"]);
    expect(data.days["2026-08-25"]?.repeatTasks.map(({ id }) => id)).toEqual(["repeat"]);
  });

  it("snaps all gantt operations to whole days", () => {
    const moved = moveTimespan("2026-08-24T09:00:00+08:00", "2026-08-26T18:00:00+08:00", "move", 2);
    expect(moved.startAt.startsWith("2026-08-26")).toBe(true);
    expect(moved.endAt.startsWith("2026-08-28")).toBe(true);
    const resized = moveTimespan(moved.startAt, moved.endAt, "end", -10);
    expect(dayDifference(resized.startAt, resized.endAt)).toBe(0);
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
  });

  it("finds the longest dependency chain", () => {
    const tasks = [
      task("a", { startAt: "2026-08-24", endAt: "2026-08-26" }),
      task("b", { startAt: "2026-08-27", endAt: "2026-08-28" }),
      task("c", { startAt: "2026-08-29", endAt: "2026-09-02" }),
      task("short", { startAt: "2026-08-24", endAt: "2026-08-24" }),
    ].map((item) => ({ ...item, progress: 0, isBlocked: false })) as GanttTask[];
    const deps: TaskDependency[] = [
      { id: "ab", predecessorId: "a", successorId: "b", type: "finish_to_start", createdAt: "" },
      { id: "bc", predecessorId: "b", successorId: "c", type: "finish_to_start", createdAt: "" },
    ];
    expect(calculateCriticalPath(tasks, deps)).toEqual(["a", "b", "c"]);
  });

  it("projects Gantt tasks as an indented tree and hides every collapsed descendant", () => {
    const root = task("root");
    const child = task("child", { parentTaskId: root.id });
    const grandchild = task("grandchild", { parentTaskId: child.id });
    const sibling = task("sibling", { parentTaskId: root.id });
    const orphan = task("orphan", { parentTaskId: "outside-range" });
    const tasks = [grandchild, child, sibling, root, orphan]
      .map((item) => ({ ...item, progress: 0, isBlocked: false })) as GanttTask[];

    expect(projectGanttTree(tasks, new Set()).map(({ task: item, depth, hasChildren }) => ({
      id: item.id,
      depth,
      hasChildren,
    }))).toEqual([
      { id: "root", depth: 0, hasChildren: true },
      { id: "child", depth: 1, hasChildren: true },
      { id: "grandchild", depth: 2, hasChildren: false },
      { id: "sibling", depth: 1, hasChildren: false },
      { id: "orphan", depth: 0, hasChildren: false },
    ]);
    expect(projectGanttTree(tasks, new Set(["root"])).map(({ task: item }) => item.id))
      .toEqual(["root", "orphan"]);
    expect(projectGanttTree(tasks, new Set(["child"])).map(({ task: item }) => item.id))
      .toEqual(["root", "child", "sibling", "orphan"]);
  });

  it("merges a view-local order without moving hidden rows", () => {
    const all = [task("a"), task("x"), task("b"), task("y"), task("c")];
    expect(mergeScopedOrder(all, ["c", "a", "b"]).map(({ id }) => id)).toEqual(["c", "x", "a", "y", "b"]);
  });

  it("moves the screenshot task before the previous visible row and preserves hidden slots", () => {
    const visible = ["previous", "system-prompt", "next"];
    const reordered = reorderTaskIds(visible, "system-prompt", "previous", "before");
    expect(reordered).toEqual(["system-prompt", "previous", "next"]);
    const all = [task("previous"), task("hidden"), task("system-prompt"), task("next")];
    expect(mergeScopedOrder(all, reordered).map(({ id }) => id))
      .toEqual(["system-prompt", "hidden", "previous", "next"]);
  });

  it("uses explicit before and after semantics in both movement directions", () => {
    expect(reorderTaskIds(["a", "b", "c"], "a", "c", "before")).toEqual(["b", "a", "c"]);
    expect(reorderTaskIds(["a", "b", "c"], "c", "a", "after")).toEqual(["a", "c", "b"]);
    expect(taskDropPosition(119, 100, 40)).toBe("before");
    expect(taskDropPosition(120, 100, 40)).toBe("after");
  });

  it("maps descendant targets to a same-level anchor without changing parentage", () => {
    const rootA = task("root-a");
    const childA = task("child-a", { parentTaskId: rootA.id });
    const rootB = task("root-b");
    const childB = task("child-b", { parentTaskId: rootB.id });
    expect(taskHierarchyReorderAnchor([rootA, childA, rootB, childB], rootB.id, childA.id))
      .toBe(rootA.id);
    expect(taskHierarchyReorderAnchor([rootA, childA, rootB, childB], childB.id, childA.id))
      .toBeNull();
    const rootOrder = reorderTaskIds([rootA.id, rootB.id], rootB.id, rootA.id, "before");
    const merged = mergeScopedOrder([rootA, childA, rootB, childB], rootOrder);
    expect(taskTreeRows(merged).map(({ task: item }) => item.id))
      .toEqual([rootB.id, childB.id, rootA.id, childA.id]);
    expect(childB.parentTaskId).toBe(rootB.id);
  });

  it("orders grouped cards by rank across parent families while today keeps tree order", () => {
    const rootA = task("root-a", { rank: 0 });
    const childA = task("child-a", { parentTaskId: rootA.id, rank: 1 });
    const rootB = task("root-b", { rank: 2 });
    const childB = task("child-b", { parentTaskId: rootB.id, rank: 3 });
    const all = [rootA, childA, rootB, childB];
    const movedIds = reorderTaskIds(
      taskRowsByRank(all).map(({ task: item }) => item.id),
      childB.id,
      childA.id,
      "before",
    );
    const persisted = mergeScopedOrder(all, movedIds)
      .map((item, rank) => ({ ...item, rank }));

    expect(taskRowsByRank(persisted).map(({ task: item }) => item.id))
      .toEqual([rootA.id, childB.id, childA.id, rootB.id]);
    expect(
      taskRowsByRank([...persisted].sort((left, right) => left.rank - right.rank))
        .filter(({ task: item }) => item.parentTaskId)
        .map(({ task: item }) => item.id),
    ).toEqual([childB.id, childA.id]);
    expect(persisted.find(({ id }) => id === childA.id)?.parentTaskId).toBe(rootA.id);
    expect(persisted.find(({ id }) => id === childB.id)?.parentTaskId).toBe(rootB.id);
    expect(taskTreeRows(persisted).map(({ task: item }) => item.id))
      .toEqual([rootA.id, childA.id, rootB.id, childB.id]);
  });

  it("identifies the third UI level so further nesting can be disabled", () => {
    const root = task("root");
    const child = task("child", { parentTaskId: root.id });
    const grandchild = task("grandchild", { parentTaskId: child.id });
    expect(hierarchyDepth(root, [root, child, grandchild])).toBe(1);
    expect(hierarchyDepth(child, [root, child, grandchild])).toBe(2);
    expect(hierarchyDepth(grandchild, [root, child, grandchild])).toBe(3);
  });

  it("projects ranked tasks into a stable three-level tree", () => {
    const root = task("root", { title: "父任务" });
    const firstChild = task("first-child", { parentTaskId: root.id });
    const secondChild = task("second-child", { parentTaskId: root.id });
    const grandchild = task("grandchild", { parentTaskId: firstChild.id });
    const tooDeep = task("too-deep", { parentTaskId: grandchild.id });
    const otherRoot = task("other-root");
    const rows = taskTreeRows([secondChild, otherRoot, root, grandchild, firstChild, tooDeep]);

    expect(rows.map(({ task: item }) => item.id)).toEqual([
      "other-root",
      "root",
      "second-child",
      "first-child",
      "grandchild",
      "too-deep",
    ]);
    expect(rows.map(({ depth }) => depth)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(rows.find(({ task: item }) => item.id === "first-child")?.ancestorTitles).toEqual(["父任务"]);
    expect(rows.find(({ task: item }) => item.id === "grandchild")?.ancestorTitles)
      .toEqual(["父任务", "first-child"]);
    expect(rows.find(({ task: item }) => item.id === "too-deep")?.ancestorTitles)
      .toEqual(["父任务", "first-child", "grandchild"]);
    expect(rows.every(({ lineageIssue }) => lineageIssue === null)).toBe(true);
  });

  it("keeps orphaned or cyclic tasks visible exactly once", () => {
    const orphan = task("orphan", { parentTaskId: "missing" });
    const cycleA = task("cycle-a", { parentTaskId: "cycle-b" });
    const cycleB = task("cycle-b", { parentTaskId: "cycle-a" });
    const rows = taskTreeRows([orphan, cycleA, cycleB]);
    expect(rows.map(({ task: item }) => item.id)).toEqual([
      "orphan",
      "cycle-a",
      "cycle-b",
    ]);
    expect(rows.find(({ task: item }) => item.id === "orphan")?.lineageIssue).toBe("missing");
    expect(rows.filter(({ task: item }) => item.id.startsWith("cycle-")).map(({ lineageIssue }) => lineageIssue))
      .toEqual(["cycle", "cycle"]);
  });

  it("hides every descendant of a collapsed parent without duplicating other rows", () => {
    const root = task("root");
    const child = task("child", { parentTaskId: root.id });
    const grandchild = task("grandchild", { parentTaskId: child.id });
    const sibling = task("sibling", { parentTaskId: root.id });
    const other = task("other");
    const rows = taskTreeRows([grandchild, other, sibling, root, child]);

    expect(visibleTaskTreeRows(rows, new Set([root.id])).map(({ task: item }) => item.id))
      .toEqual(["other", "root"]);
    expect(visibleTaskTreeRows(rows, new Set([child.id])).map(({ task: item }) => item.id))
      .toEqual(["other", "root", "sibling", "child"]);
    const crossQueueIds = new Set([root.id, grandchild.id]);
    expect(
      visibleTaskTreeRows(rows, new Set([root.id]))
        .filter(({ task: item }) => crossQueueIds.has(item.id))
        .map(({ task: item }) => item.id),
    ).toEqual(["root"]);
    expect(new Set(visibleTaskTreeRows(rows, new Set()).map(({ task: item }) => item.id)).size)
      .toBe(rows.length);
  });

  it("marks every unfinished deadline within three days for emphasis", () => {
    expect(deadlineLevel(task("soon", { deadline: "2026-08-27T18:00:00+08:00" }), "2026-08-24")).toBe("soon");
    expect(deadlineLevel(task("later", { deadline: "2026-08-28T18:00:00+08:00" }), "2026-08-24")).toBeNull();
  });
});

describe("v0.2 review projections", () => {
  it("preserves the explicitly selected carry-over date and rejects a silent fallback", () => {
    expect(carryoverDecisionsFromDrafts([
      { taskId: "a", action: "reschedule", targetDate: "2026-08-26" },
      { taskId: "b", action: "carry_today", targetDate: "2026-08-30" },
    ])).toEqual([
      { taskId: "a", action: "reschedule", targetDate: "2026-08-26" },
      { taskId: "b", action: "carry_today" },
    ]);
    expect(carryoverDecisionsFromDrafts([
      { taskId: "a", action: "reschedule", targetDate: "" },
    ])).toBeNull();
  });

  it("restores the daily plan from all tasks and reports 2 of 3 as 67%", () => {
    const all = [
      task("a", { status: "completed", plannedDate: "2026-08-24" }),
      task("b", { status: "completed", plannedDate: "2026-08-24" }),
      task("c", { status: "todo", plannedDate: "2026-08-24" }),
      task("unplanned", { status: "completed", plannedDate: "2026-08-24" }),
    ];
    const planned = dailyReviewTasks(all, [{ taskId: "a" }, { taskId: "b" }, { taskId: "c" }], "2026-08-24");
    expect(planned.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(taskCompletionRate(planned)).toBe(67);
  });

  it("keeps a completed task counted after it is archived", () => {
    expect(taskCompletionRate([
      task("archived", { status: "archived", completedAt: "2026-08-24T18:00:00+08:00" }),
      task("open"),
    ])).toBe(50);
  });

  it("normalizes weekly trend and goal aggregates", () => {
    const content = {
      dailyCompletionRates: [{ date: "2026-08-18", rate: 67.4 }, { date: "2026-08-19", rate: 120 }],
      goals: [{ goalId: "g1", completedTaskIds: ["a", "b"] }],
    };
    expect(weeklyCompletionTrend(content)).toEqual([
      { date: "2026-08-18", rate: 67 },
      { date: "2026-08-19", rate: 100 },
    ]);
    expect(weeklyGoalAggregates(content)).toEqual([{ goalId: "g1", completedCount: 2 }]);
  });

  it("shows only active goals in the monthly progress projection", () => {
    const rows = monthlyGoalReviewRows({ goals: [
      { goalId: "active", title: "产品", monthCompleted: 3, completed: 6, total: 10, percent: 60 },
      { goalId: "closed", title: "旧目标", monthCompleted: 1, completed: 1, total: 1, percent: 100 },
    ] }, new Set(["active"]));
    expect(rows).toEqual([{ goalId: "active", title: "产品", monthCompleted: 3, completed: 6, total: 10, percent: 60 }]);
  });
});
