import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  cronExpressionError,
  dependencyCandidateOptions,
  knownDirectSubtasks,
  reorderSubtaskIds,
  reorderSubtaskIdsByKey,
  subtasksAfterLoad,
  taskAncestorChain,
  TaskDrawer,
  TaskStructure,
  taskImageFileToBase64,
  taskImageSizeLabel,
  taskImageValidationError,
} from "./Drawers";
import type { LifeOSApi } from "./api";
import type { Task, TaskDependency } from "./types";

function task(id: string, title: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    version: 1,
    title,
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
    createdAt: "2026-08-24T00:00:00Z",
    updatedAt: "2026-08-24T00:00:00Z",
    ...patch,
  };
}

describe("dependencyCandidateOptions", () => {
  it("excludes current, archived and linked tasks while distinguishing duplicate titles", () => {
    const parent = task("parent-project", "产品项目");
    const first = task("task-duplicate-0001", "需求评审", { parentTaskId: parent.id });
    const second = task("task-duplicate-0002", "需求评审", { status: "in_progress" });
    const current = task("current-task", "当前任务");
    const successor = task("successor-task", "已关联后置任务");
    const archived = task("archived-task", "旧任务", { status: "archived" });
    const linked: TaskDependency = {
      id: "dependency-1",
      predecessorId: second.id,
      successorId: current.id,
      type: "finish_to_start",
      createdAt: "2026-08-24T00:00:00Z",
    };
    const outgoing: TaskDependency = {
      id: "dependency-2",
      predecessorId: current.id,
      successorId: successor.id,
      type: "finish_to_start",
      createdAt: "2026-08-24T00:00:00Z",
    };

    const options = dependencyCandidateOptions(
      current.id,
      [parent, first, second, successor, current, archived],
      [linked, outgoing],
    );

    expect(options.map(({ task: candidate }) => candidate.id)).toEqual([parent.id, first.id]);
    expect(options[1]).toMatchObject({ ancestorPath: "产品项目", statusLabel: "未开始" });
    expect(options[1]?.label).toContain(first.id);
    expect(options[0]?.shortId).not.toBe(options[1]?.shortId);
  });

  it("searches title, ancestor path, status and full id without changing the saved id", () => {
    const parent = task("parent", "公司重点项目");
    const child = task("task-searchable-id", "准备材料", { parentTaskId: parent.id, status: "completed" });
    const tasks = [parent, child];

    expect(dependencyCandidateOptions("current", tasks, [], "重点").map(({ task: item }) => item.id)).toEqual([parent.id, child.id]);
    expect(dependencyCandidateOptions("current", tasks, [], "已完成").map(({ task: item }) => item.id)).toEqual([child.id]);
    expect(dependencyCandidateOptions("current", tasks, [], "task-searchable-id")[0]?.task.id).toBe(child.id);
  });
});

describe("TaskStructure", () => {
  it("shows one action that opens the subtask editor", () => {
    const parent = task("parent", "父任务", {
      status: "in_progress",
      tags: ["项目"],
    });
    const html = renderToStaticMarkup(createElement(TaskStructure, {
      task: parent,
      api: {} as LifeOSApi,
      allTasks: [parent],
      onOpenTask: () => undefined,
      onCreateSubtask: () => undefined,
      onChanged: async () => undefined,
    }));

    expect(html).toContain("添加子任务");
    expect(html).not.toContain("添加一个子任务…");
    expect(html).not.toContain("新子任务会继承");
    expect(html).toContain("依赖关系");
    expect(html).toContain("前置任务");
    expect(html).toContain("后置任务");
    expect(html).not.toContain("前置依赖");
    expect(html).toContain('aria-label="关联前置任务"');
    expect(html).toContain('aria-label="关联后置任务"');
    expect(html).not.toContain("没有前置任务");
    expect(html).not.toContain("没有后置任务");
    expect(html).not.toContain('id="dependency-search"');
    expect(html).not.toContain('id="successor-search"');
  });

  it("shows known direct children on the first paint instead of a false empty state", () => {
    const parent = task("parent", "父任务");
    const later = task("child-later", "第二个子任务", { parentTaskId: parent.id, rank: 8 });
    const first = task("child-first", "第一个子任务", { parentTaskId: parent.id, rank: 3 });
    const grandchild = task("grandchild", "孙任务", { parentTaskId: first.id, rank: 1 });
    const html = renderToStaticMarkup(createElement(TaskStructure, {
      task: parent,
      api: {} as LifeOSApi,
      allTasks: [parent, later, grandchild, first],
      onOpenTask: () => undefined,
      onCreateSubtask: () => undefined,
      onChanged: async () => undefined,
    }));

    expect(knownDirectSubtasks(parent.id, [parent, later, grandchild, first]))
      .toEqual([first, later]);
    expect(html).toContain("第一个子任务");
    expect(html).toContain("第二个子任务");
    expect(html).not.toContain("孙任务");
    expect(html).not.toContain("还没有子任务。");
  });

  it("merges parent ancestry and children into one relationship card", () => {
    const root = task("root", "顶层项目");
    const middle = task("middle", "中层任务", { parentTaskId: root.id });
    const current = task("current", "当前任务", { parentTaskId: middle.id });
    const child = task("child", "直接子任务", { parentTaskId: current.id });
    const allTasks = [child, current, root, middle];
    const html = renderToStaticMarkup(createElement(TaskStructure, {
      task: current,
      api: {} as LifeOSApi,
      allTasks,
      onOpenTask: () => undefined,
      onCreateSubtask: () => undefined,
      onChanged: async () => undefined,
    }));

    expect(taskAncestorChain(current, allTasks)).toEqual([root, middle]);
    expect(html).toContain('aria-label="父子任务"');
    expect(html).toContain("父任务");
    expect(html).toContain("顶层项目");
    expect(html).toContain("中层任务");
    expect(html.indexOf("顶层项目")).toBeLessThan(html.indexOf("中层任务"));
    expect(html).toContain("直接父任务");
    expect(html).toContain("直接子任务");
    expect(html.match(/parent-chain-arrow/g)).toHaveLength(2);
    expect(html.match(/>↑<\/span>/g)).toHaveLength(2);
  });

  it("labels an unknown initial list as loading rather than empty", () => {
    const parent = task("parent", "父任务");
    const html = renderToStaticMarkup(createElement(TaskStructure, {
      task: parent,
      api: {} as LifeOSApi,
      allTasks: [parent],
      onOpenTask: () => undefined,
      onCreateSubtask: () => undefined,
      onChanged: async () => undefined,
    }));

    expect(html).toContain("正在加载子任务…");
    expect(html).not.toContain("还没有子任务。");
  });

  it("retains known children when the refresh fails", () => {
    const known = [task("child", "已知子任务", { parentTaskId: "parent" })];

    expect(subtasksAfterLoad(known, { status: "rejected", reason: new Error("offline") }))
      .toEqual(known);
    expect(subtasksAfterLoad(known, { status: "fulfilled", value: [] }))
      .toEqual([]);
  });

  it("opens child details without a redundant parent navigation strip", () => {
    const parent = task("parent", "季度发布计划");
    const child = task("child", "准备发布说明", { parentTaskId: parent.id, status: "in_progress" });
    const html = renderToStaticMarkup(createElement(TaskDrawer, {
      task: child,
      presentation: "rail",
      api: {} as LifeOSApi,
      allTasks: [parent, child],
      goals: [],
      taskGroups: [{
        id: "group-project",
        workspaceId: "workspace",
        name: "产品迭代",
        color: "#2F6B52",
        createdAt: "2026-08-24T00:00:00Z",
        updatedAt: "2026-08-24T00:00:00Z",
      }],
      onCreateTaskGroup: async (input) => ({
        id: "group-created",
        workspaceId: "workspace",
        ...input,
        createdAt: "2026-08-24T00:00:00Z",
        updatedAt: "2026-08-24T00:00:00Z",
      }),
      onClose: () => undefined,
      onSave: async () => undefined,
      onOpenTask: () => undefined,
      onCreateSubtask: () => undefined,
      onStructureChanged: async () => undefined,
    }));

    expect(html).not.toContain("返回父任务：季度发布计划");
    expect(html).not.toContain('aria-label="父任务导航"');
    expect(html).toContain('data-slot="task-drawer"');
    expect(html).toContain("drawer-embedded");
    expect(html).toContain('placeholder="任务名称"');
    expect(html).toContain('placeholder="描述"');
    expect(html).toContain('placeholder="标签，逗号分隔。例如：个人成长，工作，编程"');
    expect(html).toContain('aria-label="标签"');
    expect(html).toContain('aria-label="上传图片"');
    expect(html).toContain("截止日");
    expect(html).toContain("计划完成日");
    expect(html).toContain('<option value="todo">未开始</option>');
    expect(html).not.toContain(">计划日</span>");
    expect(html).not.toContain("设置后即硬任务");
    expect(html).not.toContain("Deadline");
    expect(html).not.toContain("关联目标");
    expect(html).not.toContain("未关联目标");
    expect(html).toContain('aria-label="任务分组"');
    expect(html).toContain("产品迭代");
  });

  it("renders a focused subtask draft without editing tabs or live image uploads", () => {
    const parent = task("parent", "父任务");
    const draft = task("draft", "", { parentTaskId: parent.id });
    const html = renderToStaticMarkup(createElement(TaskDrawer, {
      task: draft,
      mode: "create-subtask",
      presentation: "rail",
      api: {} as LifeOSApi,
      allTasks: [parent],
      goals: [],
      taskGroups: [],
      onCreateTaskGroup: async () => ({
        id: "group-created",
        workspaceId: "workspace",
        name: "新分组",
        color: "#2F6B52",
        createdAt: "2026-08-24T00:00:00Z",
        updatedAt: "2026-08-24T00:00:00Z",
      }),
      onClose: () => undefined,
      onSave: async () => undefined,
      onOpenTask: () => undefined,
      onCreateSubtask: () => undefined,
      onStructureChanged: async () => undefined,
    }));

    expect(html).toContain("新建子任务");
    expect(html).toContain("创建子任务后可上传图片");
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("返回父任务");
  });
});

describe("subtask reorder helpers", () => {
  const ids = ["first", "second", "third", "fourth"];

  it("uses before and after semantics for pointer drops", () => {
    expect(reorderSubtaskIds(ids, "first", "third", "before"))
      .toEqual(["second", "first", "third", "fourth"]);
    expect(reorderSubtaskIds(ids, "fourth", "second", "after"))
      .toEqual(["first", "second", "fourth", "third"]);
  });

  it("supports adjacent and boundary keyboard moves", () => {
    expect(reorderSubtaskIdsByKey(ids, "third", "ArrowUp"))
      .toEqual(["first", "third", "second", "fourth"]);
    expect(reorderSubtaskIdsByKey(ids, "second", "ArrowDown"))
      .toEqual(["first", "third", "second", "fourth"]);
    expect(reorderSubtaskIdsByKey(ids, "third", "Home"))
      .toEqual(["third", "first", "second", "fourth"]);
    expect(reorderSubtaskIdsByKey(ids, "second", "End"))
      .toEqual(["first", "third", "fourth", "second"]);
    expect(reorderSubtaskIdsByKey(ids, "first", "ArrowUp")).toEqual(ids);
  });
});

describe("cronExpressionError", () => {
  it("accepts the five-field grammar supported by the service contract", () => {
    for (const expression of [
      "0 9 * * *",
      "0 9 * * 1-5",
      "*/15 9-18 1,15 * 1-5",
      "5/10 * * * *",
      " 0 9 1 * 0,7 ",
    ]) {
      expect(cronExpressionError(expression), expression).toBeNull();
    }
  });

  it("rejects field count, range, names and invalid steps like the service contract", () => {
    for (const expression of [
      "0 9 * *",
      "60 9 * * *",
      "0 24 * * *",
      "0 9 0 * *",
      "0 9 * 13 *",
      "0 9 * * 8",
      "0 9 * * MON",
      "*/0 9 * * *",
      "1--2 9 * * *",
      "1, 9 * * *",
    ]) {
      expect(cronExpressionError(expression), expression).not.toBeNull();
    }
  });
});

describe("task image helpers", () => {
  it("accepts supported image formats within the count and size limits", () => {
    const files = [
      { name: "shot.png", type: "image/png", size: 5 * 1024 * 1024 },
      { name: "photo.jpg", type: "image/jpeg", size: 128 },
      { name: "motion.gif", type: "image/gif", size: 128 },
      { name: "preview.webp", type: "image/webp", size: 128 },
    ];

    expect(taskImageValidationError(files, 16)).toBeNull();
  });

  it("explains invalid formats, oversize files and the 20 image cap", () => {
    expect(taskImageValidationError(
      [{ name: "vector.svg", type: "image/svg+xml", size: 128 }],
      0,
    )).toContain("vector.svg");
    expect(taskImageValidationError(
      [{ name: "large.png", type: "image/png", size: 5 * 1024 * 1024 + 1 }],
      0,
    )).toContain("5MB");
    expect(taskImageValidationError(
      [{ name: "extra.png", type: "image/png", size: 128 }],
      20,
    )).toContain("最多保存 20 张");
  });

  it("encodes binary payloads without a data URL prefix and formats sizes", async () => {
    await expect(taskImageFileToBase64(new Blob(["hello"]))).resolves.toBe("aGVsbG8=");
    expect(taskImageSizeLabel(512)).toBe("512 B");
    expect(taskImageSizeLabel(1536)).toBe("1.5 KB");
    expect(taskImageSizeLabel(1572864)).toBe("1.5 MB");
  });
});
