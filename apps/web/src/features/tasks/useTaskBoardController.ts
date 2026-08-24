import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Dispatch,
  DragEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  SetStateAction,
} from "react";
import type { TaskGroup } from "../../types";
import {
  passedPointerDragThreshold,
  taskDropPosition,
  taskHierarchyReorderAnchor,
  taskQueueGroup,
} from "../../v02-utils";
import type { TaskDropPosition, TaskQueueGroupKey } from "../../v02-utils";
import { todayKey } from "../../utils";
import type { TaskBoardProps, TaskFilters } from "./contracts";
import {
  buildTaskGroupUpdatePatch,
  normalizeTaskGroupColor,
  projectTaskBoard,
} from "./model";
import type { TaskBoardProjection } from "./model";

export interface TaskDropTarget {
  id: string | "end";
  position: TaskDropPosition;
}

export interface TaskGroupEditorViewModel {
  name: string;
  color: string;
  saving: boolean;
  error: string;
  dirty: boolean;
  validationError: string;
}

export interface TaskBoardViewModel extends TaskBoardProjection {
  currentDate: string;
  taskGroupsById: ReadonlyMap<string, TaskGroup>;
  selectedFilterGroup: TaskGroup | null;
  groupEditor: TaskGroupEditorViewModel;
  collapsedTaskIds: ReadonlySet<string>;
  collapsedQueues: ReadonlySet<TaskQueueGroupKey>;
  draggingId: string | null;
  dropTarget: TaskDropTarget | null;
}

export interface TaskBoardActions {
  setGroupName: Dispatch<SetStateAction<string>>;
  setGroupColor: Dispatch<SetStateAction<string>>;
  clearGroupError: () => void;
  saveSelectedGroup: () => Promise<void>;
  clearFilters: () => void;
  selectGroup: (groupId: string) => void;
  toggleTaskChildren: (taskId: string) => void;
  toggleQueue: (key: TaskQueueGroupKey) => void;
  nativeDragStart: (event: DragEvent, taskId: string) => void;
  nativeDragEnd: () => void;
  nativeDragOver: (event: DragEvent, taskId: string) => void;
  drop: (event: DragEvent, rawTargetId: string) => void;
  dragOverEnd: (event: DragEvent) => void;
  dragLeaveEnd: (event: DragEvent) => void;
  dropAtEnd: (event?: DragEvent) => void;
  startPointer: (event: ReactPointerEvent<HTMLButtonElement>, taskId: string) => void;
  movePointer: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  finishPointer: (
    event: ReactPointerEvent<HTMLButtonElement>,
    cancelled?: boolean,
  ) => void;
  keyboardReorder: (event: KeyboardEvent<HTMLButtonElement>, taskId: string) => void;
}

export interface TaskBoardController {
  viewModel: TaskBoardViewModel;
  actions: TaskBoardActions;
}

const clearedFilters: TaskFilters = {
  temperature: "all",
  status: "all",
  tag: "",
  time: "current",
  group: "all",
};

export function useTaskBoardController(props: TaskBoardProps): TaskBoardController {
  const {
    view,
    tasks,
    taskGroups,
    filters,
    onFiltersChange,
    onUpdateTaskGroup,
    onReorder,
    completionMotions = {},
  } = props;
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<TaskDropTarget | null>(null);
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(() => new Set());
  const [collapsedQueues, setCollapsedQueues] = useState<Set<TaskQueueGroupKey>>(() => new Set());
  const initialFilterGroup = filters.group === "all" || filters.group === "ungrouped"
    ? null
    : taskGroups.find((group) => group.id === filters.group) ?? null;
  const [groupName, setGroupName] = useState(initialFilterGroup?.name ?? "");
  const [groupColor, setGroupColor] = useState(initialFilterGroup?.color ?? "");
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupError, setGroupError] = useState("");
  const selectedFilterGroupId = useRef<string | null>(null);
  const pointerDrag = useRef<{
    pointerId: number;
    taskId: string;
    startX: number;
    startY: number;
    active: boolean;
    target: TaskDropTarget | null;
  } | null>(null);
  const currentDate = todayKey();
  const taskGroupsById = useMemo(
    () => new Map(taskGroups.map((group) => [group.id, group])),
    [taskGroups],
  );
  const selectedFilterGroup = filters.group === "all" || filters.group === "ungrouped"
    ? null
    : taskGroupsById.get(filters.group) ?? null;
  selectedFilterGroupId.current = selectedFilterGroup?.id ?? null;
  const normalizedGroupDraft = buildTaskGroupUpdatePatch(groupName, groupColor);
  const groupDirty = Boolean(selectedFilterGroup && normalizedGroupDraft && (
    normalizedGroupDraft.name !== selectedFilterGroup.name ||
    normalizedGroupDraft.color !== selectedFilterGroup.color
  ));
  const groupValidationError = selectedFilterGroup && !groupName.trim()
    ? "分组名称不能为空"
    : "";

  useEffect(() => {
    setGroupName(selectedFilterGroup?.name ?? "");
    setGroupColor(selectedFilterGroup?.color ?? "");
    setGroupError("");
  }, [selectedFilterGroup]);

  const projection = useMemo(
    () => projectTaskBoard({
      view,
      tasks,
      filters,
      currentDate,
      collapsedTaskIds,
      collapsedQueues,
      completionMotions,
    }),
    [
      collapsedQueues,
      collapsedTaskIds,
      completionMotions,
      currentDate,
      filters,
      tasks,
      view,
    ],
  );

  async function saveSelectedGroup(): Promise<void> {
    if (!selectedFilterGroup) return;
    const patch = buildTaskGroupUpdatePatch(groupName, groupColor);
    if (!patch) {
      setGroupError(groupName.trim() ? "请选择有效颜色" : "分组名称不能为空");
      return;
    }
    const groupId = selectedFilterGroup.id;
    setGroupSaving(true);
    setGroupError("");
    try {
      const updated = await onUpdateTaskGroup(groupId, patch);
      if (selectedFilterGroupId.current === groupId) {
        setGroupName(updated.name);
        setGroupColor(updated.color);
      }
    } catch (reason) {
      if (selectedFilterGroupId.current === groupId) {
        setGroupError(reason instanceof Error ? reason.message : "分组更新失败，输入已保留");
      }
    } finally {
      setGroupSaving(false);
    }
  }

  function resolveReorderTarget(sourceId: string, rawTargetId: string): string | null {
    if (!projection.reorderScopeIds.includes(rawTargetId) || sourceId === rawTargetId) {
      return null;
    }
    if (view === "tasks") {
      const source = tasks.find((task) => task.id === sourceId);
      const target = tasks.find((task) => task.id === rawTargetId);
      if (
        !source ||
        !target ||
        taskQueueGroup(source, currentDate) !== taskQueueGroup(target, currentDate)
      ) return null;
      return rawTargetId;
    }
    const anchorId = taskHierarchyReorderAnchor(tasks, sourceId, rawTargetId);
    return anchorId && projection.reorderScopeIds.includes(anchorId) ? anchorId : null;
  }

  function reorderAnchorsFor(sourceId: string): string[] {
    const anchors: string[] = [];
    const seen = new Set<string>();
    for (const candidateId of projection.reorderScopeIds) {
      const anchorId = candidateId === sourceId
        ? sourceId
        : resolveReorderTarget(sourceId, candidateId);
      if (anchorId && !seen.has(anchorId)) {
        seen.add(anchorId);
        anchors.push(anchorId);
      }
    }
    return anchors;
  }

  function commitReorder(
    sourceId: string,
    rawTargetId: string,
    position: TaskDropPosition,
  ): void {
    const targetId = resolveReorderTarget(sourceId, rawTargetId);
    if (targetId && targetId !== sourceId) {
      void onReorder(sourceId, targetId, position, reorderAnchorsFor(sourceId));
    }
  }

  function drop(event: DragEvent, rawTargetId: string): void {
    event.preventDefault();
    const sourceId = draggingId ?? event.dataTransfer.getData("text/plain");
    const bounds = event.currentTarget.getBoundingClientRect();
    if (sourceId) {
      commitReorder(
        sourceId,
        rawTargetId,
        taskDropPosition(event.clientY, bounds.top, bounds.height),
      );
    }
    setDraggingId(null);
    setDropTarget(null);
  }

  function dropAtEnd(event?: DragEvent): void {
    event?.preventDefault();
    const sourceId = draggingId ?? event?.dataTransfer.getData("text/plain") ?? "";
    const anchors = reorderAnchorsFor(sourceId);
    const targetId = anchors.at(-1);
    if (sourceId && targetId && targetId !== sourceId) {
      void onReorder(sourceId, targetId, "after", anchors);
    }
    setDraggingId(null);
    setDropTarget(null);
  }

  function startPointer(event: ReactPointerEvent<HTMLButtonElement>, taskId: string): void {
    if (!projection.canReorder || event.pointerType === "mouse" || !event.isPrimary) return;
    pointerDrag.current = {
      pointerId: event.pointerId,
      taskId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      target: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePointer(event: ReactPointerEvent<HTMLButtonElement>): void {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (
      !drag.active &&
      passedPointerDragThreshold(drag.startX, drag.startY, event.clientX, event.clientY)
    ) {
      drag.active = true;
      setDraggingId(drag.taskId);
    }
    if (!drag.active) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(
      "[data-task-drop-id], [data-task-drop-end]",
    );
    let nextTarget: TaskDropTarget | null = null;
    if (target?.hasAttribute("data-task-drop-end")) {
      nextTarget = { id: "end", position: "after" };
    } else if (target?.dataset.taskDropId) {
      const anchorId = resolveReorderTarget(drag.taskId, target.dataset.taskDropId);
      if (anchorId && anchorId !== drag.taskId) {
        const bounds = target.getBoundingClientRect();
        nextTarget = {
          id: anchorId,
          position: taskDropPosition(event.clientY, bounds.top, bounds.height),
        };
      }
    }
    drag.target = nextTarget;
    setDropTarget(nextTarget);
  }

  function finishPointer(
    event: ReactPointerEvent<HTMLButtonElement>,
    cancelled = false,
  ): void {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerDrag.current = null;
    setDraggingId(null);
    setDropTarget(null);
    if (!drag.active || cancelled || !drag.target) return;
    if (drag.target.id === "end") {
      const anchors = reorderAnchorsFor(drag.taskId);
      const targetId = anchors.at(-1);
      if (targetId && targetId !== drag.taskId) {
        void onReorder(drag.taskId, targetId, "after", anchors);
      }
      return;
    }
    void onReorder(
      drag.taskId,
      drag.target.id,
      drag.target.position,
      reorderAnchorsFor(drag.taskId),
    );
  }

  function keyboardReorder(event: KeyboardEvent<HTMLButtonElement>, taskId: string): void {
    if (!projection.canReorder || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      return;
    }
    const anchors = reorderAnchorsFor(taskId);
    const index = anchors.indexOf(taskId);
    if (index < 0) return;
    const movingUp = event.key === "ArrowUp" || event.key === "Home";
    const targetId = event.key === "Home"
      ? anchors[0]
      : event.key === "End"
        ? anchors.at(-1)
        : movingUp
          ? anchors[index - 1]
          : anchors[index + 1];
    if (!targetId || targetId === taskId) return;
    event.preventDefault();
    void onReorder(taskId, targetId, movingUp ? "before" : "after", anchors);
  }

  function toggleTaskChildren(taskId: string): void {
    setCollapsedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function toggleQueue(key: TaskQueueGroupKey): void {
    setCollapsedQueues((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const viewModel: TaskBoardViewModel = {
    ...projection,
    currentDate,
    taskGroupsById,
    selectedFilterGroup,
    groupEditor: {
      name: groupName,
      color: groupColor,
      saving: groupSaving,
      error: groupError,
      dirty: groupDirty,
      validationError: groupValidationError,
    },
    collapsedTaskIds,
    collapsedQueues,
    draggingId,
    dropTarget,
  };

  return {
    viewModel,
    actions: {
      setGroupName,
      setGroupColor,
      clearGroupError: () => setGroupError(""),
      saveSelectedGroup,
      clearFilters: () => onFiltersChange({ ...clearedFilters }),
      selectGroup: (groupId) => onFiltersChange({ ...filters, group: groupId }),
      toggleTaskChildren,
      toggleQueue,
      nativeDragStart: (event, taskId) => {
        setDraggingId(taskId);
        setDropTarget(null);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", taskId);
      },
      nativeDragEnd: () => {
        setDraggingId(null);
        setDropTarget(null);
      },
      nativeDragOver: (event, taskId) => {
        if (!projection.canReorder) return;
        const sourceId = draggingId ?? event.dataTransfer.getData("text/plain");
        const anchorId = sourceId ? resolveReorderTarget(sourceId, taskId) : null;
        if (!sourceId || !anchorId || anchorId === sourceId) {
          setDropTarget(null);
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const bounds = event.currentTarget.getBoundingClientRect();
        setDropTarget({
          id: anchorId,
          position: taskDropPosition(event.clientY, bounds.top, bounds.height),
        });
      },
      drop,
      dragOverEnd: (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTarget({ id: "end", position: "after" });
      },
      dragLeaveEnd: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
      },
      dropAtEnd,
      startPointer,
      movePointer,
      finishPointer,
      keyboardReorder,
    },
  };
}

export function taskGroupEditorColor(
  editor: TaskGroupEditorViewModel,
  selectedGroup: TaskGroup,
): string {
  return normalizeTaskGroupColor(editor.color) ?? selectedGroup.color;
}
