import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildTaskGroupUpdatePatch,
  claimParentInheritance,
  matchesTaskGroupFilter,
  normalizeTaskGroupColor,
  TaskBoard,
  taskCompletionMotionDuration,
  taskGroupDisplayName,
} from "./TaskBoard";
import type { TaskBoardRenderers, TaskCompletionMotion, TaskFilters } from "./TaskBoard";
import type { Task, TaskGroup } from "./types";
import { todayKey } from "./utils";

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
  groupId: null,
  tags: [],
  scoreDimensions: null,
  score: null,
  rank: 0,
  createdAt: "2026-08-24T08:00:00.000Z",
  updatedAt: "2026-08-24T08:00:00.000Z",
};

function renderBoard(
  tasks: Task[],
  view: "tasks" | "today" = "today",
  completionMotions: Partial<Record<string, TaskCompletionMotion>> = {},
  taskGroups: TaskGroup[] = [],
  groupFilter = "all",
  allTasks: Task[] = tasks,
  temperatureFilter: TaskFilters["temperature"] = "all",
  renderers?: Partial<TaskBoardRenderers>,
): string {
  return renderToStaticMarkup(
    <TaskBoard
      view={view}
      tasks={tasks}
      allTasks={allTasks}
      taskGroups={taskGroups}
      filters={{ temperature: temperatureFilter, status: "all", tag: "", time: "current", group: groupFilter }}
      tags={[]}
      onViewChange={() => undefined}
      onFiltersChange={() => undefined}
      onCreateTask={() => undefined}
      onCreateTaskGroup={async (input) => ({
        id: "created-group",
        workspaceId: "workspace",
        ...input,
        createdAt: "2026-08-24T08:00:00.000Z",
        updatedAt: "2026-08-24T08:00:00.000Z",
      })}
      onUpdateTaskGroup={async (id, patch) => ({
        id,
        workspaceId: "workspace",
        name: "产品迭代",
        color: patch.color ?? "#2F6B52",
        createdAt: "2026-08-24T08:00:00.000Z",
        updatedAt: "2026-08-24T08:00:00.000Z",
      })}
      onUpdate={async () => undefined}
      onInheritParent={async () => undefined}
      rollForwardTargetDate={todayKey()}
      onRollForwardOverdue={async () => undefined}
      completionMotions={completionMotions}
      onOpen={() => undefined}
      onReorder={async () => undefined}
      {...(renderers ? { renderers } : {})}
    />,
  );
}

describe("TaskBoard completion motion", () => {
  it("accepts a task-row renderer without changing board orchestration", () => {
    const html = renderBoard(
      [unscoredTask],
      "today",
      {},
      [],
      "all",
      [unscoredTask],
      "all",
      { TaskRow: ({ task }) => <div data-custom-task-row={task.id}>{task.title}</div> },
    );

    expect(html).toContain('data-custom-task-row="task-unscored"');
    expect(html).toContain("未评分任务");
    expect(html).not.toContain('class="task-row');
  });

  it("keeps the source row visually completed and inert while it exits", () => {
    const activeTask = { ...unscoredTask, status: "in_progress" as const };
    const html = renderBoard([activeTask], "tasks", { [activeTask.id]: "exiting" });
    const row = html.match(/<article[^>]*data-task-drop-id="task-unscored"[\s\S]*?<\/article>/)?.[0] ?? "";

    expect(row).toContain("is-complete");
    expect(row).toContain("is-completion-exiting");
    expect(row).toContain('aria-busy="true"');
    expect(row).toMatch(/class="complete-toggle checked"[^>]*disabled/);
    expect(html).toContain("已标记完成，正在移出原队列");
  });

  it("removes motion delays when reduced motion is requested", () => {
    expect(taskCompletionMotionDuration("exiting", false)).toBe(520);
    expect(taskCompletionMotionDuration("entering", false)).toBe(360);
    expect(taskCompletionMotionDuration("restoring", false)).toBe(240);
    expect(taskCompletionMotionDuration("exiting", true)).toBe(0);
  });
});

describe("TaskBoard parent inheritance action", () => {
  it("claims a single request synchronously and rejects duplicate or root requests", () => {
    const pending = { current: false };

    expect(claimParentInheritance("parent", pending)).toBe(true);
    expect(pending.current).toBe(true);
    expect(claimParentInheritance("parent", pending)).toBe(false);
    expect(claimParentInheritance(null, { current: false })).toBe(false);
  });
});

describe("TaskBoard simplified task controls", () => {
  it("replaces the quick-create card with one new-task button", () => {
    const html = renderBoard([]);

    expect(html).toContain('class="create-task-button"');
    expect(html).toContain('aria-label="新建任务"');
    expect(html).not.toContain('class="quick-add');
    expect(html).not.toContain('aria-label="新任务标签"');
  });

  it("does not render retired score controls", () => {
    const html = renderBoard([unscoredTask]);

    expect(html).not.toContain('class="score');
    expect(html).not.toContain("综合分");
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
    const summaryEnd = parentMarkup.indexOf("</div>", summaryStart);
    const toggleStart = parentMarkup.indexOf('class="task-children-toggle"');

    expect(parentMarkup).toContain('aria-label="收起父任务的子任务"');
    expect(parentMarkup).toContain('aria-expanded="true"');
    expect(parentMarkup).toContain('draggable="false"');
    expect(summaryStart).toBeGreaterThan(-1);
    expect(summaryEnd).toBeLessThan(toggleStart);
  });

  it("offers parent inheritance on child rows and keeps it beside a nested child toggle", () => {
    const parent = { ...unscoredTask, id: "parent", title: "父任务", rank: 0 };
    const child = {
      ...unscoredTask,
      id: "child",
      title: "中间子任务",
      parentTaskId: parent.id,
      rank: 1,
    };
    const grandchild = {
      ...unscoredTask,
      id: "grandchild",
      title: "末级子任务",
      parentTaskId: child.id,
      rank: 2,
    };
    const html = renderBoard([parent, child, grandchild], "tasks");
    const childMarkup = html.match(
      /<article[^>]*data-task-drop-id="child"[\s\S]*?<\/article>/,
    )?.[0] ?? "";
    const summaryEnd = childMarkup.indexOf("</div>", childMarkup.indexOf('class="task-summary"'));
    const actionStart = childMarkup.indexOf('class="task-lineage-actions"');

    expect(childMarkup).toContain('class="task-lineage-actions"');
    expect(childMarkup).toContain('aria-label="收起中间子任务的子任务"');
    expect(childMarkup).toContain(
      'aria-label="从父任务继承中间子任务的分组与标签"',
    );
    expect(childMarkup).toMatch(/class="task-inherit-parent"[^>]*draggable="false"/);
    expect(summaryEnd).toBeLessThan(actionStart);
    expect(childMarkup).toContain("继承");
  });

  it("keeps parent inheritance available while the parent record is not loaded", () => {
    const child = {
      ...unscoredTask,
      id: "child-only",
      title: "暂缺父记录的子任务",
      parentTaskId: "parent-not-loaded",
    };
    const html = renderBoard([child], "tasks", {}, [], "all", [child]);

    expect(html).toContain(
      'aria-label="从父任务继承暂缺父记录的子任务的分组与标签"',
    );
    expect(html).toContain('title="同步父任务当前的分组与标签"');
  });
});

describe("TaskBoard task groups", () => {
  const group: TaskGroup = {
    id: "group-product",
    workspaceId: "workspace",
    name: "产品迭代",
    color: "#2F6B52",
    createdAt: "2026-08-24T08:00:00.000Z",
    updatedAt: "2026-08-24T08:00:00.000Z",
  };

  it("shows up to eight group characters and keeps the full name accessible", () => {
    expect(taskGroupDisplayName("一二三四五六七八")).toBe("一二三四五六七八");
    expect(taskGroupDisplayName("一二三四五六七八九")).toBe("一二三四五六七八…");

    const longGroup = { ...group, name: "一二三四五六七八九" };
    const html = renderBoard(
      [{ ...unscoredTask, groupId: longGroup.id }],
      "tasks",
      {},
      [longGroup],
    );
    expect(html).toContain('aria-label="按分组筛选：一二三四五六七八九"');
    expect(html).toContain("<b>一二三四五六七八…</b>");
  });

  it("matches all, ungrouped and a concrete group independently of other filters", () => {
    const grouped = { ...unscoredTask, groupId: group.id };
    const ungrouped = { ...unscoredTask, id: "ungrouped", groupId: null };

    expect(matchesTaskGroupFilter(grouped, "all")).toBe(true);
    expect(matchesTaskGroupFilter(grouped, group.id)).toBe(true);
    expect(matchesTaskGroupFilter(grouped, "ungrouped")).toBe(false);
    expect(matchesTaskGroupFilter(ungrouped, "ungrouped")).toBe(true);
  });

  it("ignores retired temperature filters and applies the task-group filter", () => {
    const hotGrouped = { ...unscoredTask, title: "热区分组任务", temperature: "hot" as const, groupId: group.id };
    const warmGrouped = { ...unscoredTask, id: "warm-grouped", title: "温区分组任务", groupId: group.id };
    const hotUngrouped = { ...unscoredTask, id: "hot-ungrouped", title: "热区未分组任务", temperature: "hot" as const };
    const tasks = [hotGrouped, warmGrouped, hotUngrouped];
    const html = renderBoard(tasks, "tasks", {}, [group], group.id, tasks, "hot");

    expect(html).toContain("热区分组任务");
    expect(html).toContain("温区分组任务");
    expect(html).not.toContain("热区未分组任务");
  });

  it("omits the redundant group filter and renders an accessible title-line group control", () => {
    const groupedTask = {
      ...unscoredTask,
      deadline: "2026-08-31",
      groupId: group.id,
      tags: ["既有标签"],
    };
    const html = renderBoard([groupedTask], "tasks", {}, [group], group.id);
    const row = html.match(
      /<article[^>]*data-task-drop-id="task-unscored"[\s\S]*?<\/article>/,
    )?.[0] ?? "";
    const summary = row.match(/<div class="task-summary">[\s\S]*?<\/div>/)?.[0] ?? "";
    const openEnd = summary.indexOf("</button>", summary.indexOf('class="task-summary-open"'));
    const titleLineStart = summary.indexOf('class="task-title-line"');
    const titleStart = summary.indexOf("<strong>未评分任务</strong>");
    const metaStart = summary.indexOf('class="task-meta"');
    const markerStart = summary.indexOf('class="task-group-marker"');

    expect(html).not.toContain('aria-label="按分组筛选"');
    expect(html).not.toContain('aria-label="按温度筛选"');
    expect(html).toContain('aria-label="新建任务"');
    expect(summary).toContain('aria-label="打开任务详情：未评分任务"');
    expect(summary).toMatch(/class="task-summary-open"[^>]*><\/button>/);
    expect(summary).toMatch(/class="task-group-marker"[^>]*aria-label="按分组筛选：产品迭代"[^>]*draggable="false"/);
    expect(row).toMatch(/class="drag-handle"[^>]*aria-disabled="true"/);
    expect(row).not.toContain('class="task-summary" disabled');
    expect(openEnd).toBeLessThan(titleLineStart);
    expect(titleLineStart).toBeLessThan(titleStart);
    expect(titleStart).toBeLessThan(markerStart);
    expect(markerStart).toBeLessThan(metaStart);
    expect(summary.slice(metaStart)).not.toContain('class="task-group-marker"');
    expect(html).toContain('aria-label="修改「产品迭代」的名称"');
    expect(html).toContain('value="产品迭代"');
    expect(html).toContain('aria-label="修改「产品迭代」的颜色"');
    expect(html).toContain("保存分组");
    expect(html).not.toContain("保存颜色");
    expect(html).toContain('--task-group-color:#2F6B52');
  });

  it("keeps the reorder handle operable only when no filter changes list scope", () => {
    const groupedTask = { ...unscoredTask, groupId: group.id };
    const unfiltered = renderBoard([groupedTask], "tasks", {}, [group], "all");
    const filtered = renderBoard([groupedTask], "tasks", {}, [group], group.id);

    expect(unfiltered).toMatch(/class="drag-handle"[^>]*aria-disabled="false"/);
    expect(filtered).toMatch(/class="drag-handle"[^>]*aria-disabled="true"/);
    expect(filtered).toContain("清除筛选后可排序");
  });

  it("keeps the title-line group control visible in completed-row markup", () => {
    const html = renderBoard([{
      ...unscoredTask,
      completedAt: `${todayKey()}T09:00:00+08:00`,
      groupId: group.id,
      status: "completed",
    }], "tasks", {}, [group]);
    const row = html.match(
      /<article[^>]*data-task-drop-id="task-unscored"[\s\S]*?<\/article>/,
    )?.[0] ?? "";

    expect(row).toMatch(/class="[^"]*task-group-row[^"]*is-complete[^"]*"/);
    expect(row).toMatch(/class="task-title-line"[\s\S]*class="task-group-marker"/);
  });

  it("keeps a grouped long title before its non-shrinking group control", () => {
    const longTitle = "这是一个需要在窄屏上优先截断而不能挤压分组标签的非常长的任务标题";
    const html = renderBoard([{
      ...unscoredTask,
      title: longTitle,
      groupId: group.id,
    }], "tasks", {}, [group]);
    const row = html.match(
      /<article[^>]*data-task-drop-id="task-unscored"[\s\S]*?<\/article>/,
    )?.[0] ?? "";
    const titleStart = row.indexOf(`<strong>${longTitle}</strong>`);
    const markerStart = row.indexOf('class="task-group-marker"');

    expect(titleStart).toBeGreaterThan(-1);
    expect(markerStart).toBeGreaterThan(titleStart);
    expect(row).toContain('aria-label="按分组筛选：产品迭代"');
  });

  it("does not reserve or announce a group control for an ungrouped task", () => {
    const html = renderBoard([unscoredTask], "tasks", {}, [group]);
    const row = html.match(
      /<article[^>]*data-task-drop-id="task-unscored"[\s\S]*?<\/article>/,
    )?.[0] ?? "";

    expect(row).toContain("<strong>未评分任务</strong>");
    expect(row).not.toContain('class="task-group-marker"');
    expect(row).not.toContain("按分组筛选：");
  });

  it("keeps the title shrinkable and the group control fixed at the narrow-screen breakpoint", () => {
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const titleRule = styles.match(/\.task-title-line strong\s*\{([^}]*)\}/)?.[1] ?? "";
    const markerRule = styles.match(/\.task-group-marker\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(titleRule).toContain("min-width: 0");
    expect(titleRule).toContain("overflow: hidden");
    expect(titleRule).toContain("flex: 0 1 auto");
    expect(titleRule).toContain("text-overflow: ellipsis");
    expect(markerRule).toContain("flex: 0 0 auto");
    expect(styles).toContain('.drag-handle[aria-disabled="true"]');
    expect(styles).toMatch(/@media \(max-width: 830px\)[\s\S]*?\.task-group-marker \{ max-width: 88px;/);
  });

  it("normalizes valid colors and rejects shorthand or unsafe values", () => {
    expect(normalizeTaskGroupColor(" #2f6b52 ")).toBe("#2F6B52");
    expect(normalizeTaskGroupColor("#abc")).toBeNull();
    expect(normalizeTaskGroupColor("red")).toBeNull();
  });

  it("trims the name and submits name and color in one group patch", () => {
    expect(buildTaskGroupUpdatePatch("  新分组名称  ", " #4d7c8a ")).toEqual({
      name: "新分组名称",
      color: "#4D7C8A",
    });
    expect(buildTaskGroupUpdatePatch("   ", "#4D7C8A")).toBeNull();
    expect(buildTaskGroupUpdatePatch("新分组名称", "invalid")).toBeNull();
  });

  it("gives the group name and color controls independent sizing", () => {
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const nameRule = styles.match(
      /\.task-group-color-editor \.task-group-name-input\s*\{([^}]*)\}/,
    )?.[1] ?? "";
    const colorRule = styles.match(
      /\.task-group-color-editor input\[type="color"\]\s*\{([^}]*)\}/,
    )?.[1] ?? "";

    expect(nameRule).toContain("width: 112px");
    expect(colorRule).toContain("width: 28px");
  });
});

describe("TaskBoard overdue queue", () => {
  it("offers one atomic roll-forward action for the visible overdue tasks", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const deadline = [
      yesterday.getFullYear(),
      String(yesterday.getMonth() + 1).padStart(2, "0"),
      String(yesterday.getDate()).padStart(2, "0"),
    ].join("-");
    const html = renderBoard([{ ...unscoredTask, deadline }], "tasks");

    expect(html).toContain("已逾期");
    expect(html).toContain("一键顺延");
    expect(html).toContain("1项逾期任务一键顺延至");
  });
});
