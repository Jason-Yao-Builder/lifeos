import { describe, expect, it } from "vitest";
import type { Task } from "../../types";
import type { ProjectTaskBoardInput } from "./model";
import { projectTaskBoard } from "./model";

const task = (patch: Partial<Task> & Pick<Task, "id" | "title" | "rank">): Task => ({
  version: 1,
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
  createdAt: "2026-08-24T08:00:00.000Z",
  updatedAt: "2026-08-24T08:00:00.000Z",
  ...patch,
});

const project = (overrides: Partial<ProjectTaskBoardInput> = {}) => projectTaskBoard({
  view: "tasks",
  tasks: [],
  filters: { temperature: "all", status: "all", tag: "", time: "current", group: "all" },
  currentDate: "2026-08-24",
  collapsedTaskIds: new Set(),
  collapsedQueues: new Set(),
  completionMotions: {},
  ...overrides,
});

describe("task board projection", () => {
  it("intersects filters before projecting queue sections", () => {
    const matching = task({
      id: "matching",
      title: "匹配任务",
      rank: 0,
      temperature: "hot",
      groupId: "group-a",
      deadline: "2026-08-24",
    });
    const wrongTemperature = task({
      id: "warm",
      title: "温区任务",
      rank: 1,
      groupId: "group-a",
      deadline: "2026-08-24",
    });
    const wrongGroup = task({
      id: "other-group",
      title: "其他分组",
      rank: 2,
      temperature: "hot",
      groupId: "group-b",
      deadline: "2026-08-24",
    });
    const result = project({
      tasks: [matching, wrongTemperature, wrongGroup],
      filters: {
        temperature: "hot",
        status: "all",
        tag: "",
        time: "current",
        group: "group-a",
      },
    });

    expect(result.visibleTasks.map(({ id }) => id)).toEqual(["matching"]);
    expect(result.queueSections).toHaveLength(1);
    expect(result.queueSections[0]?.key).toBe("due_today");
    expect(result.canReorder).toBe(false);
  });

  it("retains matched children in counts while a parent is collapsed", () => {
    const parent = task({ id: "parent", title: "父任务", rank: 0, deadline: "2026-08-24" });
    const child = task({
      id: "child",
      title: "子任务",
      rank: 1,
      parentTaskId: parent.id,
      deadline: "2026-08-24",
    });
    const result = project({
      tasks: [parent, child],
      collapsedTaskIds: new Set([parent.id]),
    });

    expect(result.matchedRows).toHaveLength(2);
    expect(result.visibleRows.map(({ task: item }) => item.id)).toEqual([parent.id]);
    expect(result.queueSections[0]?.hiddenByParent).toBe(1);
  });

  it("projects completion progress and its accessible announcement", () => {
    const completed = task({ id: "done", title: "已完成任务", rank: 0, status: "completed" });
    const active = task({ id: "active", title: "进行中任务", rank: 1 });
    const result = project({
      tasks: [completed, active],
      completionMotions: { [active.id]: "exiting" },
    });

    expect(result.completion).toBe(50);
    expect(result.completionAnnouncement).toBe("进行中任务已标记完成，正在移出原队列");
  });
});
