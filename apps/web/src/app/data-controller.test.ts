import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import {
  loadApplicationData,
  mergeDayTasks,
  taskBelongsToDate,
} from "./data-controller";
import type { ApplicationDataSource } from "./data-controller";

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
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
  };
}

function apiWith(overrides: Partial<ApplicationDataSource> = {}): ApplicationDataSource {
  return {
    getTasks: async () => [],
    getDay: async () => [],
    getCards: async () => [],
    getRules: async () => [],
    getGoals: async () => [],
    getTaskGroups: async () => [],
    ...overrides,
  };
}

describe("application data controller", () => {
  const date = "2026-08-24";

  it("defines the day membership policy without browser or React state", () => {
    expect(taskBelongsToDate(task("planned", { plannedDate: date }), date)).toBe(true);
    expect(taskBelongsToDate(task("overdue", { deadline: "2026-08-20" }), date)).toBe(true);
    expect(taskBelongsToDate(task("future", { deadline: "2026-08-25" }), date)).toBe(false);
    expect(taskBelongsToDate(task("done", { status: "completed", plannedDate: date }), date))
      .toBe(true);
    expect(taskBelongsToDate(task("archived", { status: "archived", plannedDate: date }), date))
      .toBe(false);
  });

  it("adds missing completed tasks once and preserves rank order", () => {
    const active = task("active", { rank: 2, plannedDate: date });
    const completed = task("completed", { rank: 1, plannedDate: date, status: "completed" });
    expect(mergeDayTasks([active, completed], [active], date).map((item) => item.id))
      .toEqual(["completed", "active"]);
    expect(mergeDayTasks([active, completed], [completed, active], date).map((item) => item.id))
      .toEqual(["completed", "active"]);
  });

  it("keeps tasks mandatory while degrading optional resources independently", async () => {
    const active = task("active", { deadline: date });
    const result = await loadApplicationData(apiWith({
      getTasks: async () => [active],
      getDay: async () => Promise.reject(new Error("day unavailable")),
      getCards: async () => Promise.reject(new Error("cards unavailable")),
      getRules: async () => Promise.reject(new Error("rules unavailable")),
      getTaskGroups: async () => Promise.reject(new Error("groups unavailable")),
    }), date);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.snapshot.todayTasks).toEqual([active]);
    expect(result.snapshot.cards).toEqual([]);
    expect(result.snapshot.rules).toEqual([]);
    expect(result.snapshot.taskGroups).toBeNull();
    expect(result.snapshot.aiDegraded).toBe(true);
    expect(result.snapshot.rulesError).toBe(true);
  });

  it("returns an error boundary result when the canonical task list fails", async () => {
    const reason = new Error("tasks unavailable");
    const result = await loadApplicationData(apiWith({
      getTasks: async () => Promise.reject(reason),
    }), date);
    expect(result).toEqual({ status: "error", reason });
  });
});
