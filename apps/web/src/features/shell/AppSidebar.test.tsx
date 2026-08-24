import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AppSidebarActions, AppSidebarViewModel } from "./AppSidebar";
import { AppSidebar } from "./AppSidebar";

const viewModel: AppSidebarViewModel = {
  view: "tasks",
  filters: {
    temperature: "hot",
    status: "all",
    tag: "",
    time: "all",
    group: "group-work",
  },
  offline: false,
  demoMode: false,
  settingsActive: false,
  viewsActive: false,
  activeTaskCount: 3,
  pendingCardCount: 2,
  taskGroups: [
    { id: "all", label: "全部任务", color: null, count: 4 },
    { id: "group-work", label: "工作", color: "#217A5B", count: 3 },
  ],
  temperatures: [
    { id: "all", label: "全部温度", count: 4 },
    { id: "hot", label: "热", count: 3 },
  ],
};

const actions: AppSidebarActions = {
  navigate: vi.fn(),
  navigateToTaskGroup: vi.fn(),
  changeTaskFilters: vi.fn(),
  openAi: vi.fn(),
};

describe("AppSidebar", () => {
  it("renders the complete navigation contract with preserved accessibility state", () => {
    const markup = renderToStaticMarkup(createElement(AppSidebar, {
      viewModel,
      actions,
      taskGroupsExpanded: true,
      temperaturesExpanded: true,
      onTaskGroupsExpandedChange: vi.fn(),
      onTemperaturesExpandedChange: vi.fn(),
    }));

    expect(markup).toContain('<aside class="sidebar" data-slot="app-sidebar">');
    expect(markup).toContain('aria-label="主导航"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('aria-label="任务分组"');
    expect(markup).toContain('aria-label="温度分布"');
    expect(markup).toContain('aria-label="工作，3 项任务"');
    expect(markup).toContain('aria-label="热，3 项任务"');
    expect(markup).toContain("已连接私有服务");
  });
});
