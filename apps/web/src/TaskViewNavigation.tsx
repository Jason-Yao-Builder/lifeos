import { useEffect, useRef } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from "react";

export type TaskViewKind = "calendar" | "gantt";

interface TaskViewTabsProps {
  current: TaskViewKind;
  onChange?: ((view: TaskViewKind) => void) | undefined;
}

interface SwipeStart {
  pointerId: number;
  x: number;
  y: number;
}

const views: Array<{ id: TaskViewKind; label: string }> = [
  { id: "calendar", label: "日历" },
  { id: "gantt", label: "甘特图" },
];

let keyboardFocusTarget: TaskViewKind | null = null;

export function taskViewSwipeTarget(
  current: TaskViewKind,
  deltaX: number,
  deltaY: number,
): TaskViewKind | null {
  if (Math.abs(deltaX) < 56 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return null;
  if (deltaX < 0 && current === "calendar") return "gantt";
  if (deltaX > 0 && current === "gantt") return "calendar";
  return null;
}

export function supportsTaskViewSwipePointer(pointerType: string, button: number): boolean {
  return pointerType !== "mouse" && button === 0;
}

export function TaskViewTabs({ current, onChange }: TaskViewTabsProps): ReactElement {
  const activeTab = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (keyboardFocusTarget !== current) return;
    keyboardFocusTarget = null;
    activeTab.current?.focus();
  }, [current]);

  function activate(view: TaskViewKind, preserveKeyboardFocus = false): void {
    if (view === current || !onChange) return;
    if (preserveKeyboardFocus) keyboardFocusTarget = view;
    onChange(view);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? views.length - 1
        : event.key === "ArrowLeft"
          ? (index - 1 + views.length) % views.length
          : (index + 1) % views.length;
    const next = views[nextIndex];
    if (next) activate(next.id, true);
  }

  return (
    <div className="task-view-tabs" role="tablist" aria-label="任务视图">
      {views.map((view, index) => (
        <button
          type="button"
          role="tab"
          id={`task-view-tab-${view.id}`}
          aria-controls={`task-view-panel-${view.id}`}
          aria-selected={current === view.id}
          tabIndex={current === view.id ? 0 : -1}
          className={current === view.id ? "active" : ""}
          ref={current === view.id ? activeTab : undefined}
          key={view.id}
          onClick={() => activate(view.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}

export function useTaskViewSwipe(
  current: TaskViewKind,
  onChange?: (view: TaskViewKind) => void,
): {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
} {
  const start = useRef<SwipeStart | null>(null);

  function onPointerDown(event: ReactPointerEvent<HTMLElement>): void {
    if (!onChange || !supportsTaskViewSwipePointer(event.pointerType, event.button)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button, a, input, select, textarea, [contenteditable], .calendar-grid, .gantt-scroll")) return;
    start.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>): void {
    const origin = start.current;
    start.current = null;
    if (!origin || origin.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const next = taskViewSwipeTarget(current, event.clientX - origin.x, event.clientY - origin.y);
    if (next) onChange?.(next);
  }

  return {
    onPointerDown,
    onPointerUp,
    onPointerCancel: () => { start.current = null; },
  };
}
