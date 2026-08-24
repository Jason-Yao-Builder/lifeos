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
});

describe("demo subtask inheritance", () => {
  it("ignores forged tags and status, then exposes inherited values after refresh", async () => {
    const api = demoApi();
    const forgedInput: CreateTask = {
      title: "  继承测试  ",
      temperature: "cold",
      status: "todo",
      plannedDate: null,
      tags: ["伪造标签"],
    };

    const child = await api.createSubtask("task-proposal", forgedInput);
    expect(child).toMatchObject({
      title: "继承测试",
      parentTaskId: "task-proposal",
      temperature: "cold",
      plannedDate: null,
      status: "in_progress",
      tags: ["项目", "深度工作"],
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
