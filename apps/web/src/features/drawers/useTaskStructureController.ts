import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RepeatTemplate,
  Task,
  TaskDependency,
  TaskProgress,
} from "../../types";
import type { TaskStructureProps } from "./contracts";
import { hierarchyDepth } from "../../v02-utils";
import {
  drawerError,
  knownDirectSubtasks,
  subtasksAfterLoad,
} from "./model";

export type TaskStructureLoadState = "loading" | "ready" | "error";

export interface TaskStructureViewState {
  subtasks: Task[];
  subtaskLoadState: TaskStructureLoadState;
  dependencies: TaskDependency[];
  progress: TaskProgress;
  templates: RepeatTemplate[];
  busy: boolean;
  reordering: boolean;
  reorderNotice: string;
  error: string;
}

export interface TaskStructureActions {
  reload: () => Promise<void>;
  clearError: () => void;
  addSubtask: (title: string) => Promise<boolean>;
  persistSubtaskOrder: (nextIds: string[]) => Promise<boolean>;
  addDependency: (predecessorId: string) => Promise<boolean>;
  removeDependency: (dependencyId: string) => Promise<boolean>;
  createRepeat: (cronExpr: string) => Promise<boolean>;
  generateRepeat: (templateId: string) => Promise<boolean>;
}

export interface TaskStructureController {
  viewState: TaskStructureViewState;
  actions: TaskStructureActions;
}

export function useTaskStructureController({
  task,
  api,
  allTasks,
  onChanged,
}: Pick<TaskStructureProps, "task" | "api" | "allTasks" | "onChanged">): TaskStructureController {
  const [subtasks, setSubtasks] = useState<Task[]>(() => knownDirectSubtasks(task.id, allTasks));
  const [subtaskLoadState, setSubtaskLoadState] = useState<TaskStructureLoadState>("loading");
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  const [progress, setProgress] = useState<TaskProgress>({ completed: 0, total: 0, percent: 0 });
  const [templates, setTemplates] = useState<RepeatTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [reorderNotice, setReorderNotice] = useState("");
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const onChangedRef = useRef(onChanged);

  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  const reload = useCallback(async (): Promise<void> => {
    const currentRequestId = ++requestId.current;
    setError("");
    setSubtaskLoadState("loading");
    const [subtaskResult, dependencyResult, progressResult, templateResult] = await Promise.allSettled([
      api.getSubtasks(task.id),
      api.getDependencies(task.id),
      api.getTaskProgress(task.id),
      api.getRepeatTemplates(),
    ]);
    if (currentRequestId !== requestId.current) return;
    setSubtasks((current) => subtasksAfterLoad(current, subtaskResult));
    setSubtaskLoadState(subtaskResult.status === "fulfilled" ? "ready" : "error");
    if (dependencyResult.status === "fulfilled") setDependencies(dependencyResult.value);
    if (progressResult.status === "fulfilled") setProgress(progressResult.value);
    if (templateResult.status === "fulfilled") setTemplates(templateResult.value);
    if ([subtaskResult, dependencyResult, progressResult].some((result) => result.status === "rejected")) {
      setError("部分结构数据暂时无法读取。");
    }
  }, [api, task.id]);

  useEffect(() => {
    void reload();
    return () => {
      requestId.current += 1;
    };
  }, [reload]);

  async function addSubtask(title: string): Promise<boolean> {
    if (!title.trim() || hierarchyDepth(task, allTasks) >= 3) return false;
    setBusy(true);
    setError("");
    try {
      await api.createSubtask(task.id, {
        title: title.trim(),
        temperature: task.temperature,
        plannedDate: task.plannedDate,
      });
      await Promise.all([reload(), onChangedRef.current()]);
      return true;
    } catch (reason) {
      setError(drawerError(reason, "子任务创建失败"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function persistSubtaskOrder(nextIds: string[]): Promise<boolean> {
    const currentIds = subtasks.map((item) => item.id);
    if (
      reordering
      || nextIds.length !== currentIds.length
      || nextIds.every((id, index) => id === currentIds[index])
    ) return false;
    const previous = subtasks;
    const byId = new Map(previous.map((item) => [item.id, item]));
    const optimistic = nextIds
      .map((id) => byId.get(id))
      .filter((item): item is Task => Boolean(item));
    if (optimistic.length !== previous.length) return false;
    setSubtasks(optimistic);
    setReordering(true);
    setError("");
    setReorderNotice("正在保存子任务顺序…");
    try {
      const saved = await api.reorderSubtasks(task.id, nextIds);
      setSubtasks(saved);
      setSubtaskLoadState("ready");
      setReorderNotice("子任务顺序已保存。");
    } catch (reason) {
      setSubtasks(previous);
      setError(drawerError(reason, "子任务排序失败，已恢复原顺序"));
      setReorderNotice("排序失败，已恢复原顺序。");
      return false;
    } finally {
      setReordering(false);
    }
    try {
      await onChangedRef.current();
    } catch {
      setError("子任务顺序已保存，但任务列表暂时无法刷新。");
    }
    return true;
  }

  async function addDependency(predecessorId: string): Promise<boolean> {
    if (!predecessorId) return false;
    return runMutation(
      () => api.addDependency(task.id, predecessorId),
      "依赖创建失败",
    );
  }

  async function removeDependency(dependencyId: string): Promise<boolean> {
    return runMutation(
      () => api.deleteDependency(task.id, dependencyId),
      "依赖删除失败",
    );
  }

  async function createRepeat(cronExpr: string): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const template = await api.createRepeatTemplate({
        title: task.title,
        description: task.description,
        temperature: task.temperature,
        tags: task.tags,
        goalId: task.goalId ?? null,
        cronExpr: cronExpr.trim(),
      });
      await api.updateTask(task.id, task.version, { repeatTemplateId: template.id });
      await Promise.all([reload(), onChangedRef.current()]);
      return true;
    } catch (reason) {
      setError(drawerError(reason, "重复模板创建失败"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function generateRepeat(templateId: string): Promise<boolean> {
    setError("");
    try {
      await api.generateRepeatTemplate(templateId);
      return true;
    } catch (reason) {
      setError(drawerError(reason, "重复任务生成失败"));
      return false;
    }
  }

  async function runMutation(
    mutation: () => Promise<unknown>,
    fallback: string,
  ): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      await mutation();
      await Promise.all([reload(), onChangedRef.current()]);
      return true;
    } catch (reason) {
      setError(drawerError(reason, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    viewState: {
      subtasks,
      subtaskLoadState,
      dependencies,
      progress,
      templates,
      busy,
      reordering,
      reorderNotice,
      error,
    },
    actions: {
      reload,
      clearError: () => setError(""),
      addSubtask,
      persistSubtaskOrder,
      addDependency,
      removeDependency,
      createRepeat,
      generateRepeat,
    },
  };
}
