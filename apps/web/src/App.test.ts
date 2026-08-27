import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  App,
  isSettingsArea,
  isViewsArea,
  isKnownTaskGroup,
  shouldCloseTaskOnViewChange,
  shouldPushTaskGroupNavigation,
  TaskGroupSidebar,
  taskFiltersForGroup,
  taskFiltersForHistoryEntry,
  taskGroupFromLocation,
  taskGroupNavigationItems,
  taskGroupPath,
  taskHistoryState,
  viewForPathname,
} from "./App";
import type { TaskFilters } from "./TaskBoard";

describe("application navigation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps view, settings and goals routes directly addressable", () => {
    expect(viewForPathname("/calendar")).toBe("calendar");
    expect(viewForPathname("/gantt")).toBe("gantt");
    expect(viewForPathname("/settings")).toBe("settings");
    expect(viewForPathname("/goals")).toBe("goals");
    expect(viewForPathname("/review/weekly/2026-08-24")).toBe("review");
    expect(viewForPathname("/unknown")).toBe("tasks");
  });

  it("treats goals as part of the settings area for navigation state", () => {
    expect(isSettingsArea("settings")).toBe(true);
    expect(isSettingsArea("goals")).toBe(true);
    expect(isSettingsArea("tasks")).toBe(false);
  });

  it("treats calendar and gantt as one views navigation area", () => {
    expect(isViewsArea("calendar")).toBe(true);
    expect(isViewsArea("gantt")).toBe(true);
    expect(isViewsArea("tasks")).toBe(false);
  });

  it("closes an expanded task whenever navigation enters another view", () => {
    expect(shouldCloseTaskOnViewChange("tasks", "calendar")).toBe(true);
    expect(shouldCloseTaskOnViewChange("calendar", "gantt")).toBe(true);
    expect(shouldCloseTaskOnViewChange("calendar", "calendar")).toBe(false);
    expect(shouldCloseTaskOnViewChange("calendar", "tasks")).toBe(false);
  });

  it("renders one views entry for calendar and gantt routes", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/gantt", search: "" },
      history: { state: null },
    });
    vi.stubGlobal("navigator", { onLine: true });

    const html = renderToStaticMarkup(createElement(App));
    const sidebar = html.slice(html.indexOf('<aside class="sidebar"'), html.indexOf("</aside>"));
    const mobileNav = html.slice(html.indexOf('<nav class="mobile-nav"'), html.indexOf("</nav>", html.indexOf('<nav class="mobile-nav"')));

    expect(sidebar).toContain('<span>视图</span>');
    expect(sidebar).not.toContain('<span>日历</span>');
    expect(sidebar).not.toContain('<span>甘特图</span>');
    expect(sidebar).toMatch(/class="active" aria-current="page"[^>]*><span aria-hidden="true">▦<\/span><span>视图<\/span>/);
    expect(mobileNav).toContain('<small>视图</small>');
    expect(mobileNav).not.toContain('<small>日历</small>');
    expect(mobileNav).not.toContain('<small>甘特</small>');
  });

  it("renders settings and task groups without the retired temperature section", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/tasks", search: "" },
      history: { state: null },
    });
    vi.stubGlobal("navigator", { onLine: true });

    const html = renderToStaticMarkup(createElement(App));
    const sidebar = html.slice(html.indexOf('<aside class="sidebar"'), html.indexOf("</aside>"));
    const settingsIndex = sidebar.indexOf("<span>设置</span>");
    const taskGroupsIndex = sidebar.indexOf('aria-label="任务分组"');

    expect(settingsIndex).toBeGreaterThan(-1);
    expect(taskGroupsIndex).toBeGreaterThan(settingsIndex);
    expect(sidebar).not.toContain("温度分布");
    expect(html).not.toContain('aria-label="移动端温度"');
  });
});

describe("task group navigation", () => {
  const groups = [
    { id: "group-internship", name: "复星实习", color: "#0DE311" },
    { id: "group-personal", name: "个人价值创造", color: "#E9FA00" },
  ];
  const items = taskGroupNavigationItems([
    { groupId: "group-internship" },
    { groupId: "group-internship" },
    { groupId: null },
    { groupId: "legacy-group" },
  ], groups);

  it("lists all, ungrouped and every custom group with literal task counts", () => {
    expect(items).toEqual([
      { id: "all", label: "全部任务", color: null, count: 4 },
      { id: "ungrouped", label: "未分组", color: null, count: 1 },
      { id: "group-internship", label: "复星实习", color: "#0DE311", count: 2 },
      { id: "group-personal", label: "个人价值创造", color: "#E9FA00", count: 0 },
    ]);
  });

  it("changes only the controlled group filter", () => {
    const filters: TaskFilters = {
      temperature: "hot",
      status: "todo",
      tag: "API",
      time: "target_future",
      group: "all",
    };

    expect(taskFiltersForGroup(filters, "group-internship")).toEqual({
      ...filters,
      group: "group-internship",
    });
  });

  it("uses a canonical URL that omits all and encodes concrete groups", () => {
    expect(taskGroupPath("all")).toBe("/tasks");
    expect(taskGroupPath("ungrouped")).toBe("/tasks?group=ungrouped");
    expect(taskGroupPath("复星 实习")).toBe("/tasks?group=%E5%A4%8D%E6%98%9F+%E5%AE%9E%E4%B9%A0");
    expect(taskGroupPath("all", "hot")).toBe("/tasks");
    expect(taskGroupPath("group-internship", "warm"))
      .toBe("/tasks?group=group-internship");
    expect(taskGroupFromLocation("/tasks", "?group=group-internship")).toBe("group-internship");
    expect(taskGroupFromLocation("/tasks", "?group=all")).toBe("all");
    expect(taskGroupFromLocation("/today", "?group=group-internship")).toBe("all");
  });

  it("restores validated transient filters while the URL remains authoritative for group", () => {
    const stored: TaskFilters = {
      temperature: "hot",
      status: "todo",
      tag: "API",
      time: "target_future",
      group: "group-personal",
    };
    const state = taskHistoryState(stored, { preserved: true });

    expect(state.preserved).toBe(true);
    expect(taskFiltersForHistoryEntry(
      "/tasks",
      "?group=group-internship&temperature=warm",
      state,
    )).toEqual({
      ...stored,
      group: "group-internship",
      temperature: "all",
    });
    expect(taskFiltersForHistoryEntry("/gantt", "?group=group-internship", state)).toEqual({
      temperature: "all",
      status: "all",
      tag: "",
      time: "current",
      group: "all",
    });
    expect(taskFiltersForHistoryEntry("/tasks", "?group=ungrouped&temperature=unsafe", {
      lifeosTaskFilters: { ...stored, temperature: "unsafe" },
    })).toEqual({
      temperature: "all",
      status: "all",
      tag: "",
      time: "current",
      group: "ungrouped",
    });
  });

  it("does not push the current canonical group but navigates across groups or views", () => {
    expect(shouldPushTaskGroupNavigation(
      "/tasks",
      "?group=group-internship",
      "group-internship",
      "group-internship",
    )).toBe(false);
    expect(shouldPushTaskGroupNavigation(
      "/tasks",
      "?group=group-internship",
      "group-internship",
      "group-personal",
    )).toBe(true);
    expect(shouldPushTaskGroupNavigation("/gantt", "", "all", "all")).toBe(true);
    expect(shouldPushTaskGroupNavigation(
      "/tasks",
      "?group=group-internship&temperature=hot",
      "group-internship",
      "group-internship",
      "hot",
    )).toBe(true);
  });

  it("accepts reserved groups and loaded ids but rejects a stale URL id", () => {
    expect(isKnownTaskGroup("all", groups)).toBe(true);
    expect(isKnownTaskGroup("ungrouped", groups)).toBe(true);
    expect(isKnownTaskGroup("group-personal", groups)).toBe(true);
    expect(isKnownTaskGroup("deleted-group", groups)).toBe(false);
  });

  it("renders an accessible active color item and can collapse its list", () => {
    const expanded = renderToStaticMarkup(createElement(TaskGroupSidebar, {
      items,
      selected: "group-internship",
      expanded: true,
      onToggle: () => undefined,
      onSelect: () => undefined,
    }));
    const collapsed = renderToStaticMarkup(createElement(TaskGroupSidebar, {
      items,
      selected: "group-internship",
      expanded: false,
      onToggle: () => undefined,
      onSelect: () => undefined,
    }));

    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain('aria-label="复星实习，2 项任务"');
    expect(expanded).toContain('aria-pressed="true"');
    expect(expanded).not.toContain('aria-current="page"');
    expect(expanded).toContain('--sidebar-group-color:#0DE311');
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).not.toContain('id="sidebar-task-group-list"');
  });
});
