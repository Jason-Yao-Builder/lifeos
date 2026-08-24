import { afterEach, describe, expect, it, vi } from "vitest";
import { createApi } from "./api";
import { createDemoApi } from "./demo";
import type { TaskGroup } from "./types";

function stubWindowTimers(): void {
  vi.stubGlobal("window", {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
}

function group(patch: Partial<TaskGroup> = {}): TaskGroup {
  return {
    id: "group-product",
    workspaceId: "workspace",
    name: "产品迭代",
    color: "#2F6B52",
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
    ...patch,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("task group HTTP API", () => {
  it("uses the frozen list, create and patch endpoints without reshaping payloads", async () => {
    stubWindowTimers();
    const created = group();
    const updated = group({ color: "#4D7C8A" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [created] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApi();

    await expect(api.getTaskGroups()).resolves.toEqual([created]);
    await expect(api.createTaskGroup({ name: "产品迭代", color: "#2F6B52" }))
      .resolves.toEqual(created);
    await expect(api.updateTaskGroup("group /1", { color: "#4D7C8A" }))
      .resolves.toEqual(updated);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/task-groups");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/task-groups");
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)))
      .toEqual({ name: "产品迭代", color: "#2F6B52" });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/v1/task-groups/group%20%2F1");
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body)))
      .toEqual({ color: "#4D7C8A" });
  });
});

describe("demo task groups", () => {
  it("validates, persists and applies groups while subtasks inherit the parent", async () => {
    stubWindowTimers();
    let savedStore: string | null = null;
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => savedStore),
      setItem: vi.fn((_key: string, value: string) => { savedStore = value; }),
    });
    const api = createDemoApi();
    const created = await api.createTaskGroup({ name: "  市场活动  ", color: "#9a6a3a" });

    expect(created).toMatchObject({ name: "市场活动", color: "#9A6A3A" });
    await expect(api.createTaskGroup({ name: "市场活动", color: "#9A6A3A" }))
      .rejects.toThrow("同名");
    await expect(api.createTaskGroup({ name: "无效", color: "red" }))
      .rejects.toThrow("#RRGGBB");

    const parent = await api.createTask({
      title: "分组父任务",
      temperature: "warm",
      groupId: created.id,
    });
    const child = await api.createSubtask(parent.id, {
      title: "继承分组",
      temperature: "cold",
    });
    expect(child.groupId).toBe(created.id);
    const ungrouped = await api.updateTask(parent.id, parent.version, { groupId: null });
    expect(ungrouped.groupId).toBeNull();

    const recolored = await api.updateTaskGroup(created.id, { color: "#526d9b" });
    expect(recolored.color).toBe("#526D9B");
    const refreshed = createDemoApi();
    await expect(refreshed.getTaskGroups()).resolves.toContainEqual(recolored);
  });
});
