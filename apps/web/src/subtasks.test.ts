import { afterEach, describe, expect, it, vi } from "vitest";
import { createApi } from "./api";
import type { CreateSubtaskInput } from "./api";
import { createDemoApi } from "./demo";
import type { CreateTask, Task } from "./types";

function stubWindowTimers(): void {
  vi.stubGlobal("window", {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
}

function demoApi(): ReturnType<typeof createDemoApi> {
  stubWindowTimers();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
  });
  return createDemoApi();
}

const inheritedChild: Task = {
  id: "child-1",
  version: 1,
  title: "子任务",
  description: null,
  temperature: "hot",
  status: "in_progress",
  hardness: "soft",
  deadline: null,
  plannedDate: null,
  parentTaskId: "parent-1",
  groupId: null,
  tags: ["父标签"],
  score: null,
  rank: 1,
  createdAt: "2026-08-24T00:00:00.000Z",
  updatedAt: "2026-08-24T00:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("subtask API", () => {
  it("sends only authored fields and trusts the returned inherited fields", async () => {
    stubWindowTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(inheritedChild),
      { status: 201 },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApi();
    const input: CreateSubtaskInput = {
      title: "子任务",
      temperature: "hot",
      plannedDate: null,
    };

    await expect(api.createSubtask("parent-1", input)).resolves.toEqual(inheritedChild);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual(input);
    expect(JSON.parse(String(init.body))).not.toHaveProperty("tags");
    expect(JSON.parse(String(init.body))).not.toHaveProperty("status");
    expect(JSON.parse(String(init.body))).not.toHaveProperty("groupId");
  });

  it("posts the complete sibling order and unwraps the returned items", async () => {
    stubWindowTimers();
    const reordered = [
      { ...inheritedChild, id: "child-2", title: "第二项", rank: 1 },
      { ...inheritedChild, id: "child-1", title: "第一项", rank: 2 },
    ];
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ items: reordered }),
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApi();

    await expect(api.reorderSubtasks("parent /1", ["child-2", "child-1"]))
      .resolves.toEqual(reordered);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/tasks/parent%20%2F1/subtasks/reorder",
      expect.objectContaining({ method: "POST" }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ orderedIds: ["child-2", "child-1"] });
  });

  it("posts the current version when inheriting from the direct parent", async () => {
    stubWindowTimers();
    const inherited = { ...inheritedChild, version: 2, groupId: "group-parent", score: 88 };
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ task: inherited }),
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApi();

    await expect(api.inheritParentTask("child /1", 1)).resolves.toEqual(inherited);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/tasks/child%20%2F1/inherit-parent",
      expect.objectContaining({ method: "POST" }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ version: 1 });
  });
});

describe("demo subtask inheritance", () => {
  it("copies the parent's current score snapshot", async () => {
    const api = demoApi();
    const scoreDimensions = { impact: 80, urgency: 70, alignment: 60, effort: 40 };
    const parent = await api.createTask({
      title: "有评分的父任务",
      temperature: "hot",
      scoreDimensions,
    });

    const child = await api.createSubtask(parent.id, {
      title: "继承评分的子任务",
      temperature: "warm",
    });

    expect(child.scoreDimensions).toEqual(scoreDimensions);
    expect(child.scoreDimensions).not.toBe(parent.scoreDimensions);
    expect(child.score).toBe(parent.score);
  });

  it("ignores forged tags and status, then exposes inherited values after refresh", async () => {
    const api = demoApi();
    const forgedInput: CreateTask = {
      title: "  继承测试  ",
      temperature: "cold",
      status: "todo",
      plannedDate: null,
      tags: ["伪造标签"],
      groupId: "伪造分组",
    };

    const child = await api.createSubtask("task-proposal", forgedInput);
    expect(child).toMatchObject({
      title: "继承测试",
      parentTaskId: "task-proposal",
      temperature: "cold",
      plannedDate: null,
      status: "in_progress",
      tags: ["项目", "深度工作"],
      groupId: "group-product",
    });
    expect(child.tags).not.toBe(forgedInput.tags);
    await expect(api.getSubtasks("task-proposal")).resolves.toContainEqual(child);
    await expect(api.getTasks()).resolves.toContainEqual(child);
  });

  it("derives completion metadata when the parent status is completed", async () => {
    const api = demoApi();
    const parent = await api.updateTask("task-proposal", 3, { status: "completed" });
    const child = await api.createSubtask(parent.id, {
      title: "已完成子任务",
      temperature: "warm",
    });

    expect(child.status).toBe("completed");
    expect(child.completedAt).toBe(child.createdAt);
    expect(child.tags).toEqual(parent.tags);
  });

  it("atomically reapplies the parent's group, tags, and score snapshot", async () => {
    const api = demoApi();
    const parent = await api.updateTask("task-proposal", 3, {
      tags: ["父任务标签"],
      scoreDimensions: { impact: 90, urgency: 80, alignment: 70, effort: 20 },
    });
    const child = await api.createSubtask(parent.id, {
      title: "可重新继承的子任务",
      temperature: "warm",
    });
    const customized = await api.updateTask(child.id, child.version, {
      groupId: null,
      tags: ["自定义标签"],
      scoreDimensions: { impact: 10, urgency: 20, alignment: 30, effort: 40 },
    });

    const inherited = await api.inheritParentTask(customized.id, customized.version);

    expect(inherited).toMatchObject({
      groupId: parent.groupId,
      tags: parent.tags,
      scoreDimensions: parent.scoreDimensions,
      score: parent.score,
      version: customized.version + 1,
    });
    expect(inherited.tags).not.toBe(parent.tags);
    expect(inherited.scoreDimensions).not.toBe(parent.scoreDimensions);
  });

  it("strictly reorders all direct siblings in their existing rank slots and persists it", async () => {
    stubWindowTimers();
    let savedStore: string | null = null;
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => savedStore),
      setItem: vi.fn((_key: string, value: string) => {
        savedStore = value;
      }),
    });
    const api = createDemoApi();
    await api.createSubtask("task-proposal", { title: "新增一", temperature: "warm" });
    await api.createSubtask("task-proposal", { title: "新增二", temperature: "cold" });
    const before = await api.getSubtasks("task-proposal");
    const originalRankSlots = before.map((task) => task.rank).sort((left, right) => left - right);
    const orderedIds = before.map((task) => task.id).reverse();
    const unrelatedBefore = (await api.getTasks()).find((task) => task.id === "task-run")!;

    const reordered = await api.reorderSubtasks("task-proposal", orderedIds);

    expect(reordered.map((task) => task.id)).toEqual(orderedIds);
    expect(reordered.map((task) => task.rank)).toEqual(originalRankSlots);
    const unrelatedAfter = (await api.getTasks()).find((task) => task.id === "task-run")!;
    expect(unrelatedAfter.rank).toBe(unrelatedBefore.rank);
    await expect(api.reorderSubtasks("task-proposal", orderedIds.slice(1)))
      .rejects.toThrow("全部直接子任务");
    await expect(api.reorderSubtasks("task-proposal", [...orderedIds.slice(1), orderedIds[1]!]))
      .rejects.toThrow("全部直接子任务");
    await expect(api.reorderSubtasks("task-proposal", [...orderedIds.slice(1), "task-run"]))
      .rejects.toThrow("全部直接子任务");
    await expect(api.getSubtasks("task-proposal"))
      .resolves.toMatchObject(reordered);

    const refreshedApi = createDemoApi();
    await expect(refreshedApi.getSubtasks("task-proposal"))
      .resolves.toMatchObject(reordered);
  });
});
