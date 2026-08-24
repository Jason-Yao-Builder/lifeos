import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  supportsTaskViewSwipePointer,
  TaskViewTabs,
  taskViewSwipeTarget,
} from "./TaskViewNavigation";

describe("TaskViewTabs", () => {
  it("uses tab semantics with a single keyboard focus target", () => {
    const markup = renderToStaticMarkup(createElement(TaskViewTabs, { current: "calendar" }));

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="任务视图"');
    expect(markup).toContain('aria-controls="task-view-panel-calendar"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('tabindex="-1"');
  });
});

describe("task view swipe", () => {
  it("switches only across a dominant horizontal threshold", () => {
    expect(taskViewSwipeTarget("calendar", -80, 12)).toBe("gantt");
    expect(taskViewSwipeTarget("gantt", 80, -12)).toBe("calendar");
    expect(taskViewSwipeTarget("calendar", -40, 2)).toBeNull();
    expect(taskViewSwipeTarget("calendar", -80, 72)).toBeNull();
    expect(taskViewSwipeTarget("calendar", 80, 0)).toBeNull();
    expect(taskViewSwipeTarget("gantt", -80, 0)).toBeNull();
  });

  it("accepts touch and pen primary pointers but never mouse dragging", () => {
    expect(supportsTaskViewSwipePointer("touch", 0)).toBe(true);
    expect(supportsTaskViewSwipePointer("pen", 0)).toBe(true);
    expect(supportsTaskViewSwipePointer("mouse", 0)).toBe(false);
    expect(supportsTaskViewSwipePointer("touch", 2)).toBe(false);
  });
});
