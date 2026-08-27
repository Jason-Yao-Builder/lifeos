import type { CSSProperties, ReactElement } from "react";
import type { TaskStatus } from "../../types";
import type { TaskRowRendererProps } from "../../features/tasks";
import "./compact-task-row.css";

function nextStatus(status: TaskStatus): TaskStatus | null {
  if (status === "todo") return "in_progress";
  if (status === "in_progress") return "completed";
  if (status === "completed" || status === "archived") return "todo";
  return status === "abandoned" ? "archived" : null;
}

export function CompactTaskRow({
  task,
  parentTask,
  group,
  depth,
  canReorder,
  dragging,
  completionMotion,
  onUpdate,
  onOpen,
  onSelectGroup,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onPointerStart,
  onPointerMove,
  onPointerEnd,
  onKeyboardReorder,
}: TaskRowRendererProps): ReactElement {
  const status = nextStatus(task.status);
  const done = task.status === "completed" || task.status === "archived";
  const busy = completionMotion !== null;
  const style = {
    "--compact-task-accent": group?.color ?? "var(--ui-color-border-strong)",
  } as CSSProperties;

  return (
    <article
      className={`compact-task-row ${done ? "is-complete" : ""} ${dragging ? "is-dragging" : ""}`}
      style={style}
      data-slot="task-row"
      data-status={task.status}
      data-depth={depth}
      data-state={done ? "complete" : "active"}
      role="treeitem"
      aria-level={depth}
      aria-busy={busy || undefined}
      data-task-drop-id={task.id}
      draggable={canReorder && !busy}
      onDragStart={(event) => onDragStart(event, task.id)}
      onDragEnd={onDragEnd}
      onDragOver={(event) => onDragOver(event, task.id)}
      onDrop={(event) => onDrop(event, task.id)}
    >
      <button
        type="button"
        className="compact-task-row__handle"
        aria-label={`拖动排序：${task.title}`}
        disabled={!canReorder || busy}
        onPointerDown={(event) => onPointerStart(event, task.id)}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => onPointerEnd(event)}
        onPointerCancel={(event) => onPointerEnd(event, true)}
        onKeyDown={(event) => onKeyboardReorder(event, task.id)}
      >
        ⠿
      </button>
      <button
        type="button"
        className="compact-task-row__status"
        aria-label={done ? "恢复到待办" : "推进任务状态"}
        disabled={!status || busy}
        onClick={() => status && void onUpdate(task, { status })}
      >
        {done ? "●" : "○"}
      </button>
      <button type="button" className="compact-task-row__summary" onClick={() => onOpen(task)}>
        <strong>{task.title}</strong>
        <small>{parentTask ? `隶属：${parentTask.title}` : task.status}</small>
      </button>
      {group && (
        <button
          type="button"
          className="compact-task-row__group"
          onClick={() => onSelectGroup(group.id)}
        >
          {group.name}
        </button>
      )}
    </article>
  );
}
