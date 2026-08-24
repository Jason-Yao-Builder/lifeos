import type { CSSProperties, ReactElement } from "react";
import { CoachIcon, SettingsIcon } from "../../Icons";
import type {
  AppShellActions,
  AppShellViewModel,
  AppTaskFilters,
  AppView,
  TaskGroupNavigationItem,
  TemperatureNavigationItem,
} from "../../app/contracts";
import { taskFiltersForTemperature } from "../../app/navigation";

type SidebarGroupStyle = CSSProperties & { "--sidebar-group-color"?: string };

export type AppSidebarViewModel = Pick<
  AppShellViewModel,
  | "view"
  | "filters"
  | "offline"
  | "demoMode"
  | "settingsActive"
  | "viewsActive"
  | "activeTaskCount"
  | "pendingCardCount"
  | "taskGroups"
  | "temperatures"
>;

export type AppSidebarActions = Pick<
  AppShellActions,
  "navigate" | "navigateToTaskGroup" | "changeTaskFilters" | "openAi"
>;

export interface AppSidebarProps {
  viewModel: AppSidebarViewModel;
  actions: AppSidebarActions;
  taskGroupsExpanded: boolean;
  temperaturesExpanded: boolean;
  onTaskGroupsExpandedChange(expanded: boolean): void;
  onTemperaturesExpandedChange(expanded: boolean): void;
}

export function TaskGroupSidebar({
  items,
  selected,
  expanded,
  onToggle,
  onSelect,
}: {
  items: readonly TaskGroupNavigationItem[];
  selected: AppTaskFilters["group"] | null;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (group: AppTaskFilters["group"]) => void;
}): ReactElement {
  return (
    <section className="sidebar-task-groups" aria-label="任务分组">
      <button
        type="button"
        className="sidebar-task-groups-toggle"
        aria-expanded={expanded}
        aria-controls="sidebar-task-group-list"
        onClick={onToggle}
      >
        <span>任务分组</span>
        <span aria-hidden="true">{expanded ? "⌄" : "›"}</span>
      </button>
      {expanded && (
        <div id="sidebar-task-group-list" className="sidebar-task-group-list" role="group" aria-label="按任务分组筛选">
          {items.map((item) => {
            const active = selected === item.id;
            const style = item.color
              ? ({ "--sidebar-group-color": item.color } as SidebarGroupStyle)
              : undefined;
            return (
              <button
                type="button"
                key={item.id}
                className={`sidebar-task-group-link ${active ? "active" : ""}`}
                style={style}
                aria-label={`${item.label}，${item.count} 项任务`}
                aria-pressed={active}
                onClick={() => onSelect(item.id)}
              >
                <i
                  className={`sidebar-task-group-dot ${item.color ? "is-custom" : `is-${item.id}`}`}
                  aria-hidden="true"
                />
                <span>{item.label}</span>
                <small>{item.count}</small>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function TemperatureSidebar({
  items,
  selected,
  expanded,
  onToggle,
  onSelect,
}: {
  items: readonly TemperatureNavigationItem[];
  selected: AppTaskFilters["temperature"];
  expanded: boolean;
  onToggle: () => void;
  onSelect: (temperature: AppTaskFilters["temperature"]) => void;
}): ReactElement {
  return (
    <section className="sidebar-task-groups sidebar-temperatures" aria-label="温度分布">
      <button
        type="button"
        className="sidebar-task-groups-toggle"
        aria-expanded={expanded}
        aria-controls="sidebar-temperature-list"
        onClick={onToggle}
      >
        <span>温度分布</span>
        <span aria-hidden="true">{expanded ? "⌄" : "›"}</span>
      </button>
      {expanded && (
        <div id="sidebar-temperature-list" className="sidebar-task-group-list" role="group" aria-label="按温度筛选">
          {items.map((item) => {
            const active = selected === item.id;
            return (
              <button
                type="button"
                key={item.id}
                className={`sidebar-task-group-link sidebar-temperature-link is-${item.id} ${active ? "active" : ""}`}
                aria-label={`${item.label}，${item.count} 项任务`}
                aria-pressed={active}
                onClick={() => onSelect(item.id)}
              >
                <i className={`sidebar-temperature-dot is-${item.id}`} aria-hidden="true" />
                <span>{item.label}</span>
                <small>{item.count}</small>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function taskAreaActive(view: AppView): boolean {
  return ["tasks", "today", "review"].includes(view);
}

export function AppSidebar({
  viewModel,
  actions,
  taskGroupsExpanded,
  temperaturesExpanded,
  onTaskGroupsExpandedChange,
  onTemperaturesExpandedChange,
}: AppSidebarProps): ReactElement {
  const taskActive = taskAreaActive(viewModel.view);
  return (
    <aside className="sidebar" data-slot="app-sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true"><i /></span>
        <div><strong>LifeOS</strong><small>把时间留给重要的事</small></div>
      </div>
      <nav className="primary-nav" aria-label="主导航">
        <button
          type="button"
          className={taskActive ? "active" : ""}
          aria-current={taskActive ? "page" : undefined}
          onClick={() => actions.navigate("tasks")}
        >
          <span aria-hidden="true">☰</span>
          <span>任务</span>
          <small>{viewModel.activeTaskCount}</small>
        </button>
        <button
          type="button"
          className={viewModel.viewsActive ? "active" : ""}
          aria-current={viewModel.viewsActive ? "page" : undefined}
          onClick={() => {
            if (!viewModel.viewsActive) actions.navigate("calendar");
          }}
        >
          <span aria-hidden="true">▦</span><span>视图</span>
        </button>
      </nav>
      <div className="sidebar-section">
        <span className="sidebar-label">协同</span>
        <button type="button" className="sidebar-link" onClick={actions.openAi}>
          <span><CoachIcon /></span>
          <span>AI 教练</span>
          {viewModel.pendingCardCount > 0 && (
            <small className="nav-badge">{viewModel.pendingCardCount}</small>
          )}
        </button>
      </div>
      <div className="sidebar-section">
        <span className="sidebar-label">系统</span>
        <button
          type="button"
          className={`sidebar-link ${viewModel.settingsActive ? "active" : ""}`}
          aria-current={viewModel.settingsActive ? "page" : undefined}
          onClick={() => actions.navigate("settings")}
        >
          <span><SettingsIcon /></span>
          <span>设置</span>
        </button>
      </div>
      <TaskGroupSidebar
        items={viewModel.taskGroups}
        selected={viewModel.view === "tasks" ? viewModel.filters.group : null}
        expanded={taskGroupsExpanded}
        onToggle={() => onTaskGroupsExpandedChange(!taskGroupsExpanded)}
        onSelect={actions.navigateToTaskGroup}
      />
      <TemperatureSidebar
        items={viewModel.temperatures}
        selected={viewModel.filters.temperature}
        expanded={temperaturesExpanded}
        onToggle={() => onTemperaturesExpandedChange(!temperaturesExpanded)}
        onSelect={(temperature) => actions.changeTaskFilters(
          taskFiltersForTemperature(viewModel.filters, temperature),
        )}
      />
      <div className="sidebar-foot">
        <span className="avatar">Y</span>
        <div>
          <strong>我的 LifeOS</strong>
          <small>{viewModel.demoMode ? "本地演示数据" : "已连接私有服务"}</small>
        </div>
        <span
          className={`connection-dot ${viewModel.offline ? "offline" : ""}`}
          title={viewModel.offline ? "离线" : "在线"}
        />
      </div>
    </aside>
  );
}
