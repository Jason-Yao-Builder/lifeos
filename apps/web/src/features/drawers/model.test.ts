import { describe, expect, it } from "vitest";
import type { RepeatTemplate, Task, TaskProgress } from "../../types";
import {
  createTaskDraft,
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
    const projection = projectTaskStructure({
      task: child,
      allTasks: [parent, child, sibling],
      subtasks: [task("one"), task("two")],
      dependencies: [{
        id: "dependency",
        predecessorId: parent.id,
        successorId: child.id,
        type: "finish_to_start",
        createdAt: "2026-08-24T00:00:00Z",
      }],
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
  });

  it("retains known children when a background refresh fails", () => {
    const children = [task("child")];
    expect(subtasksAfterLoad(children, {
      status: "rejected",
      reason: new Error("offline"),
    })).toEqual(children);
  });
});
