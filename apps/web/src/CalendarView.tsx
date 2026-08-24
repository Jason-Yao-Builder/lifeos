import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, PointerEvent as ReactPointerEvent, ReactElement } from "react";
import type { LifeOSApi } from "./api";
import type { CalendarData, CalendarMode, Task } from "./types";
import {
  addDays,
  calendarAnchorForMonth,
  dateRange,
  deadlineLevel,
  localDate,
  monthGrid,
  passedPointerDragThreshold,
  stepCalendarAnchor,
  startOfWeek,
} from "./v02-utils";
import { statusLabels, temperatureLabels } from "./utils";

interface CalendarViewProps {
  api: LifeOSApi;
  tasks: Task[];
  onOpen: (task: Task) => void;
  onTaskSaved: (task: Task) => void;
  onToast: (message: string) => void;
}

function rangeFor(anchor: string, mode: CalendarMode): string[] {
  if (mode === "day") return [anchor];
  if (mode === "week") return dateRange(startOfWeek(anchor), addDays(startOfWeek(anchor), 6));
  return monthGrid(anchor);
}

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" })
    .format(new Date(`${date}T12:00:00`));
}

export function CalendarView({
  api,
  tasks,
  onOpen,
  onTaskSaved,
  onToast,
}: CalendarViewProps): ReactElement {
  const today = localDate(new Date());
  const [anchor, setAnchor] = useState(today);
  const [mode, setMode] = useState<CalendarMode>("month");
  const [data, setData] = useState<CalendarData>({ days: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const monthPicker = useRef<HTMLInputElement>(null);
  const days = useMemo(() => rangeFor(anchor, mode), [anchor, mode]);
  const start = days[0] ?? anchor;
  const end = days.at(-1) ?? anchor;

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      setData(await api.getCalendar(start, end, mode));
    } catch {
      setError("日历数据暂时无法读取。");
    } finally {
      setLoading(false);
    }
  }, [api, end, mode, start]);

  useEffect(() => {
    void load();
  }, [load]);

  function step(amount: number): void {
    setAnchor((current) => stepCalendarAnchor(current, mode, amount));
  }

  function openMonthPicker(): void {
    const input = monthPicker.current;
    if (!input) return;
    try {
      if (typeof input.showPicker === "function") {
        input.showPicker();
        return;
      }
    } catch {
      // The native fallback below remains available when showPicker is restricted.
    }
    input.focus({ preventScroll: true });
    input.click();
  }

  async function moveTask(id: string, date: string): Promise<void> {
    const task = tasks.find((item) => item.id === id);
    if (!task || task.plannedDate?.slice(0, 10) === date) return;
    const previous = data;
    setData((current) => moveInCalendar(current, task, date));
    setDraggedId(null);
    try {
      const saved = await api.rescheduleTask(task, date);
      onTaskSaved(saved);
      onToast(`已移到 ${date}`);
      await load();
    } catch (reason) {
      setData(previous);
      onToast(reason instanceof Error ? reason.message : "移动失败，已恢复原日期");
    }
  }

  const title = mode === "month"
    ? `${anchor.slice(0, 4)} 年 ${Number(anchor.slice(5, 7))} 月`
    : mode === "week"
      ? `${dateLabel(start)} — ${dateLabel(end)}`
      : dateLabel(anchor);

  return (
    <section className="board v02-page calendar-page" aria-labelledby="calendar-title">
      <header className="v02-page-header">
        <div><p className="eyebrow">把任务放进时间</p><h1 id="calendar-title">日历</h1></div>
        <div className="view-switcher" role="group" aria-label="日历视图">
          {(["month", "week", "day"] as CalendarMode[]).map((item) => (
            <button type="button" className={mode === item ? "active" : ""} aria-pressed={mode === item} key={item} onClick={() => setMode(item)}>
              {{ month: "月", week: "周", day: "日" }[item]}
            </button>
          ))}
        </div>
      </header>
      <div className="calendar-toolbar">
        <button type="button" className="button button-secondary" onClick={() => step(-1)} aria-label={`上一个${{ month: "月", week: "周", day: "日" }[mode]}`}>←</button>
        <button type="button" className="button button-secondary" onClick={() => setAnchor(today)}>今天</button>
        <div className="calendar-period-picker">
          <button
            type="button"
            className="calendar-period-trigger"
            aria-label={`选择年月，当前${title}`}
            onClick={openMonthPicker}
          >
            <strong>{title}</strong><span aria-hidden="true">⌄</span>
          </button>
          <input
            ref={monthPicker}
            className="calendar-month-input"
            type="month"
            tabIndex={-1}
            aria-label="选择年月"
            value={anchor.slice(0, 7)}
            onChange={(event) => {
              const next = calendarAnchorForMonth(anchor, event.currentTarget.value, mode);
              if (next) setAnchor(next);
            }}
          />
        </div>
        <button type="button" className="button button-secondary" onClick={() => step(1)} aria-label={`下一个${{ month: "月", week: "周", day: "日" }[mode]}`}>→</button>
      </div>
      {error && <div className="inline-error"><span>{error}</span><button onClick={() => void load()}>重试</button></div>}
      {loading ? <div className="v02-loading">正在排列日历…</div> : (
        <CalendarGrid
          days={days}
          data={data}
          mode={mode}
          anchor={anchor}
          today={today}
          onOpen={onOpen}
          onDrag={setDraggedId}
          onMove={moveTask}
          onHtmlDrop={(event, date) => {
            event.preventDefault();
            const id = draggedId ?? event.dataTransfer.getData("text/task-id");
            if (id) void moveTask(id, date);
          }}
        />
      )}
    </section>
  );
}

function moveInCalendar(data: CalendarData, task: Task, date: string): CalendarData {
  const days = Object.fromEntries(Object.entries(data.days).map(([key, value]) => [key, {
    ...value,
    tasks: value.tasks.filter((item) => item.id !== task.id),
    repeatTasks: value.repeatTasks.filter((item) => item.id !== task.id),
  }]));
  const next = { ...task, plannedDate: date };
  days[date] ??= { tasks: [], deadlineTasks: [], repeatTasks: [] };
  days[date].tasks.push(next);
  if (task.repeatTemplateId) days[date].repeatTasks.push(next);
  return { days };
}

interface CalendarGridProps {
  days: string[];
  data: CalendarData;
  mode: CalendarMode;
  anchor: string;
  today: string;
  onOpen: (task: Task) => void;
  onDrag: (id: string | null) => void;
  onMove: (taskId: string, date: string) => Promise<void>;
  onHtmlDrop: (event: DragEvent, date: string) => void;
}

function CalendarGrid({
  days,
  data,
  mode,
  anchor,
  today,
  onOpen,
  onDrag,
  onMove,
  onHtmlDrop,
}: CalendarGridProps): ReactElement {
  const weekday = ["一", "二", "三", "四", "五", "六", "日"];
  const touchDrag = useRef<{
    pointerId: number;
    taskId: string;
    startX: number;
    startY: number;
    active: boolean;
    targetDate: string | null;
  } | null>(null);
  const suppressClick = useRef<string | null>(null);
  const [touchTarget, setTouchTarget] = useState<string | null>(null);

  function startTouch(event: ReactPointerEvent<HTMLButtonElement>, taskId: string): void {
    if (event.pointerType === "mouse" || !event.isPrimary) return;
    touchDrag.current = {
      pointerId: event.pointerId,
      taskId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      targetDate: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveTouch(event: ReactPointerEvent<HTMLButtonElement>): void {
    const drag = touchDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active && passedPointerDragThreshold(drag.startX, drag.startY, event.clientX, event.clientY)) {
      drag.active = true;
      onDrag(drag.taskId);
    }
    if (!drag.active) return;
    event.preventDefault();
    const scroller = event.currentTarget.closest<HTMLElement>(".calendar-page");
    if (event.clientX < 36) scroller?.scrollBy({ left: -18 });
    if (event.clientX > window.innerWidth - 36) scroller?.scrollBy({ left: 18 });
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-calendar-date]");
    drag.targetDate = cell?.dataset.calendarDate ?? null;
    setTouchTarget(drag.targetDate);
  }

  function finishTouch(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false): void {
    const drag = touchDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    touchDrag.current = null;
    setTouchTarget(null);
    onDrag(null);
    if (!drag.active) return;
    suppressClick.current = drag.taskId;
    window.setTimeout(() => {
      if (suppressClick.current === drag.taskId) suppressClick.current = null;
    }, 0);
    if (!cancelled && drag.targetDate) void onMove(drag.taskId, drag.targetDate);
  }

  return (
    <div className={`calendar-grid calendar-${mode}`}>
      <p className="sr-only" id="calendar-drag-help">桌面端可拖动；触屏长按并移动到新日期。</p>
      {mode !== "day" && weekday.map((item) => <div className="calendar-weekday" key={item}>周{item}</div>)}
      {days.map((date) => {
        const day = data.days[date] ?? { tasks: [], deadlineTasks: [], repeatTasks: [] };
        const deadlineIds = new Set(day.deadlineTasks.map((task) => task.id));
        const plannedIds = new Set(day.tasks.map((task) => task.id));
        const items = [...day.tasks, ...day.deadlineTasks.filter((task) => !plannedIds.has(task.id))];
        return (
          <article
            className={`calendar-cell ${date === today ? "is-today" : ""} ${touchTarget === date ? "is-touch-target" : ""} ${mode === "month" && date.slice(0, 7) !== anchor.slice(0, 7) ? "outside" : ""}`}
            key={date}
            data-calendar-date={date}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onHtmlDrop(event, date)}
          >
            <header><strong>{date.slice(8, 10).replace(/^0/, "")}</strong><small>{date}</small></header>
            <div className="calendar-items">
              {items.map((task) => {
                const onlyDeadline = deadlineIds.has(task.id) && task.plannedDate?.slice(0, 10) !== date;
                const level = deadlineLevel(task, today);
                const movable = !onlyDeadline && task.status !== "completed";
                return (
                  <button
                    type="button"
                    className={`calendar-task temperature-${task.temperature} ${onlyDeadline ? "deadline-only" : ""} ${level ? `deadline-${level}` : ""}`}
                    draggable={movable}
                    key={`${task.id}-${onlyDeadline ? "deadline" : "planned"}`}
                    aria-describedby={movable ? "calendar-drag-help" : undefined}
                    aria-label={`${task.title}，${movable ? "可拖动调整日期" : "不可拖动"}`}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/task-id", task.id);
                      onDrag(task.id);
                    }}
                    onDragEnd={() => onDrag(null)}
                    onPointerDown={movable ? (event) => startTouch(event, task.id) : undefined}
                    onPointerMove={movable ? moveTouch : undefined}
                    onPointerUp={movable ? (event) => finishTouch(event) : undefined}
                    onPointerCancel={movable ? (event) => finishTouch(event, true) : undefined}
                    onClick={(event) => {
                      if (suppressClick.current === task.id) {
                        event.preventDefault();
                        return;
                      }
                      onOpen(task);
                    }}
                    title={`${task.title}｜${temperatureLabels[task.temperature]}｜${statusLabels[task.status]}`}
                  >
                    {task.repeatTemplateId && <span aria-label="重复任务">↻</span>}
                    {onlyDeadline && <span aria-label="Deadline">◆</span>}
                    <span>{task.title}</span>
                  </button>
                );
              })}
              {items.length === 0 && mode === "day" && <p className="calendar-empty">这天还没有安排</p>}
            </div>
          </article>
        );
      })}
    </div>
  );
}
