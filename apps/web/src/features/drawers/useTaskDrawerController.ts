import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { TaskEvent, UpdateTask } from "../../types";
import { mergeTags } from "../../utils";
import type { TaskDrawerProps, TaskDrawerTab } from "./contracts";
import { createTaskDraft, drawerError } from "./model";

export interface TaskDrawerViewModel {
  tab: TaskDrawerTab;
  draft: UpdateTask;
  history: TaskEvent[];
  historyState: "idle" | "loading" | "error";
  saving: boolean;
  error: string;
  tagInput: string;
  groupCreatorOpen: boolean;
}

export interface TaskDrawerActions {
  setTab: Dispatch<SetStateAction<TaskDrawerTab>>;
  patchDraft: (patch: Partial<UpdateTask>) => void;
  updateDraft: (updater: (current: UpdateTask) => UpdateTask) => void;
  setTagInput: Dispatch<SetStateAction<string>>;
  commitTags: () => void;
  removeTag: (tag: string) => void;
  setGroupCreatorOpen: Dispatch<SetStateAction<boolean>>;
  submit: () => Promise<boolean>;
}

export interface TaskDrawerController {
  viewModel: TaskDrawerViewModel;
  actions: TaskDrawerActions;
}

export function useTaskDrawerController(
  input: Pick<TaskDrawerProps, "task" | "api" | "onSave" | "onClose">,
): TaskDrawerController {
  const { task, api, onSave, onClose } = input;
  const [tab, setTab] = useState<TaskDrawerTab>("details");
  const [draft, setDraft] = useState<UpdateTask>(() => createTaskDraft(task));
  const [history, setHistory] = useState<TaskEvent[]>([]);
  const [historyState, setHistoryState] = useState<"idle" | "loading" | "error">("idle");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [groupCreatorOpen, setGroupCreatorOpen] = useState(false);
  const previousTaskId = useRef<string | null>(null);

  useEffect(() => {
    setDraft(createTaskDraft(task));
    if (!task || previousTaskId.current === null) setTab("details");
    setError("");
    setTagInput("");
    setGroupCreatorOpen(false);
    previousTaskId.current = task?.id ?? null;
  }, [task]);

  useEffect(() => {
    if (!task || tab !== "history") return;
    let active = true;
    setHistoryState("loading");
    void api.getTaskEvents(task.id).then((events) => {
      if (!active) return;
      setHistory(events);
      setHistoryState("idle");
    }).catch(() => {
      if (active) setHistoryState("error");
    });
    return () => {
      active = false;
    };
  }, [api, tab, task]);

  function updateDraft(updater: (current: UpdateTask) => UpdateTask): void {
    setDraft(updater);
  }

  function patchDraft(patch: Partial<UpdateTask>): void {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function commitTags(): void {
    if (!tagInput.trim()) return;
    setDraft((current) => ({ ...current, tags: mergeTags(current.tags ?? [], tagInput) }));
    setTagInput("");
  }

  function removeTag(tag: string): void {
    setDraft((current) => ({
      ...current,
      tags: (current.tags ?? []).filter((item) => item !== tag),
    }));
  }

  async function submit(): Promise<boolean> {
    if (!task) return false;
    if (!draft.title?.trim()) {
      setError("任务名称不能为空");
      return false;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(task, {
        ...draft,
        title: draft.title.trim(),
        tags: mergeTags(draft.tags ?? [], tagInput),
      });
      onClose();
      return true;
    } catch (reason) {
      setError(drawerError(reason, "保存失败"));
      return false;
    } finally {
      setSaving(false);
    }
  }

  return {
    viewModel: { tab, draft, history, historyState, saving, error, tagInput, groupCreatorOpen },
    actions: {
      setTab,
      patchDraft,
      updateDraft,
      setTagInput,
      commitTags,
      removeTag,
      setGroupCreatorOpen,
      submit,
    },
  };
}
