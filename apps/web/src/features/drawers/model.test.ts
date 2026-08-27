import { describe, expect, it } from "vitest";
import type { RepeatTemplate, Task, TaskEvent, TaskProgress } from "../../types";
import {
  createTaskDraft,
  projectTaskHistory,
  projectTaskStructure,
  subtasksAfterLoad,
  taskParent,
} from "./model";

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
    createdAt: "2026-08-24T00:00:00Z",
    updatedAt: "2026-08-24T00:00:00Z",
    ...patch,
  };
}

describe("drawer projections", () => {
  it("groups one atomic save into one history batch", () => {
    const event = (
      id: string,
      field: string,
      newValue: unknown,
      summary = `task.created: ${field}`,
    ): TaskEvent => ({
      id,
      taskId: "task",
      field,
      oldValue: null,
      newValue,
      actor: "user",
      summary,
      createdAt: "2026-08-24T00:00:00Z",
    });
    const events = [
      event("save-id:0", "id", "task"),
      event("save-id:1", "title", "新任务"),
      event("save-id:2", "status", "todo"),
      event("save-id:3", "temperature", "warm"),
    ];

    expect(projectTaskHistory(events)).toMatchObject([{
      id: "save-id",
      type: "task.created",
      totalCount: 3,
      events: [
        { field: "id" },
        { field: "title" },
        { field: "status" },
      ],
    }]);
  });

  it("matches individual history entries by key or value without splitting the batch", () => {
    const events: TaskEvent[] = [
      {
        id: "save-id:0",
        batchId: "save-id",
        type: "task.created",
        taskId: "task",
        field: "title",
        oldValue: null,
        newValue: "发布说明",
        actor: "user",
        summary: "task.created: title",
        createdAt: "2026-08-24T00:00:00Z",
      },
      {
        id: "save-id:1",
        batchId: "save-id",
        type: "task.created",
        taskId: "task",
        field: "status",
        oldValue: null,
        newValue: "todo",
        actor: "user",
        summary: "task.created: status",
        createdAt: "2026-08-24T00:00:00Z",
      },
    ];

    expect(projectTaskHistory(events, "key:title")[0]).toMatchObject({
      id: "save-id",
      totalCount: 2,
      events: [{ field: "title" }],
    });
    expect(projectTaskHistory(events, "发布")[0]?.events[0]?.field).toBe("title");
    expect(projectTaskHistory(events, "key:missing")).toEqual([]);
  });

  it("creates an editable draft without sharing the source tag array", () => {
    const source = task("task", {
      deadline: "2026-08-24T08:00:00Z",
      plannedDate: "2026-08-25T08:00:00Z",
      tags: ["工作"],
    });
    const draft = createTaskDraft(source);

    expect(draft.deadline).toBe("2026-08-24");
    expect(draft.plannedDate).toBe("2026-08-25");
    expect(draft.tags).toEqual(["工作"]);
    expect(draft.tags).not.toBe(source.tags);
  });

  it("projects parent, repeat and interaction capabilities independently of markup", () => {
    const parent = task("parent");
    const child = task("child", { parentTaskId: parent.id, repeatTemplateId: "repeat" });
    const sibling = task("sibling", { parentTaskId: parent.id });
    const template = { id: "repeat" } as RepeatTemplate;
    const progress = { completed: 5, total: 2, percent: 250 } as TaskProgress;
    const successor = task("successor");
    const projection = projectTaskStructure({
      task: child,
      allTasks: [parent, child, sibling, successor],
      subtasks: [task("one"), task("two")],
      dependencies: [
        {
          id: "dependency-incoming",
          predecessorId: parent.id,
          successorId: child.id,
          type: "finish_to_start",
          createdAt: "2026-08-24T00:00:00Z",
        },
        {
          id: "dependency-outgoing",
          predecessorId: child.id,
          successorId: successor.id,
          type: "finish_to_start",
          createdAt: "2026-08-24T00:00:00Z",
        },
      ],
      templates: [template],
      progress,
      subtaskLoadState: "ready",
      reordering: false,
    });

    expect(taskParent(child, [parent, child])).toBe(parent);
    expect(projection).toMatchObject({
      depth: 2,
      parentTask: parent,
      relatedTemplate: template,
      canReorderSubtasks: true,
      canCreateSubtask: true,
      progressPercent: 100,
    });
    expect(projection.incomingDependencies).toHaveLength(1);
    expect(projection.outgoingDependencies).toHaveLength(1);
    expect(projection.outgoingDependencies[0]?.successorId).toBe(successor.id);
  });

  it("retains known children when a background refresh fails", () => {
    const children = [task("child")];
    expect(subtasksAfterLoad(children, {
      status: "rejected",
      reason: new Error("offline"),
    })).toEqual(children);
  });
});
