import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  DragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from "react";
import type { LifeOSApi } from "./api";
import { TaskViewTabs, useTaskViewSwipe } from "./TaskViewNavigation";
import type { TaskViewKind } from "./TaskViewNavigation";
import type { GanttData, GanttTask, Goal, Task, TaskGroup, Temperature } from "./types";
import {
  addDays,
  addMonths,
  dateAtHorizontalPointer,
  dateRange,
  dayDifference,
  localDate,
  monthTimelineSegments,
  monthTimelineWindow,
  moveTimespan,
  passedPointerDragThreshold,
  projectGanttTree,
} from "./v02-utils";

type Scale = "day" | "week" | "month";
type DragOperation = "move" | "start" | "end";

export interface GanttDragPreview {
  taskId: string;
  rowIndex: number;
  operation: DragOperation;
  origin: string;
  targetDate: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  label: string;
}

interface ActiveGanttDrag {
  task: GanttTask;
  rowIndex: number;
  operation: DragOperation;
  origin: string;
  taskStart: string;
  taskEnd: string;
}

function shortDate(value: string): string {
  return `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;
}

export function ganttDragPreview(
  task: Pick<GanttTask, "id" | "isBlocked">,
  rowIndex: number,
  taskStart: string,
  taskEnd: string,
  operation: DragOperation,
  origin: string,
  targetDate: string | null,
): GanttDragPreview | null {
  if (task.isBlocked || !targetDate) return null;
  const moved = moveTimespan(taskStart, taskEnd, operation, dayDifference(origin, targetDate));
  const startDate = moved.startAt.slice(0, 10);
  const endDate = moved.endAt.slice(0, 10);
  const dayCount = dayDifference(startDate, endDate) + 1;
  return {
    taskId: task.id,
    rowIndex,
    operation,
    origin,
    targetDate,
    startDate,
    endDate,
    dayCount,
    label: `${shortDate(startDate)} → ${shortDate(endDate)} · ${dayCount}天`,
  };
}

interface GanttViewProps {
  api: LifeOSApi;
  goals: Goal[];
  taskRevision: string;
  onOpen: (task: Task) => void;
  onTaskSaved: (task: Task) => void;
  onToast: (message: string) => void;
  onViewChange?: (view: TaskViewKind) => void;
}

const pixels: Record<Scale, number> = { day: 34, week: 18, month: 8 };

type GanttColorStyle = CSSProperties & {
  "--task-group-color"?: string;
  "--task-group-fill"?: string;
  "--task-group-gradient"?: string;
  "--task-group-progress"?: string;
  "--gantt-preview-fill"?: string;
  "--gantt-preview-border"?: string;
};

const temperatureFills: Record<Temperature, string> = {
  hot: "#f3cfc9",
  warm: "#f2dfb4",
  cold: "#d7e6ed",
  inspiration: "#e5dcef",
};

const temperatureBorders: Record<Temperature, string> = {
  hot: "#c87869",
  warm: "#af873d",
  cold: "#7197a8",
  inspiration: "#9276a9",
};

function lightGroupFill(color: string): string {
  const channels = [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
  return `#${channels.map((channel) =>
    Math.round(channel + (255 - channel) * 0.76).toString(16).padStart(2, "0"),
  ).join("")}`;
}

function clampedProgress(progress: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
}

export function ganttGroupGradient(color: string, progress: number): string {
  const fill = lightGroupFill(color);
  const stop = clampedProgress(progress);
  return `linear-gradient(90deg, ${color} 0%, ${color} ${stop}%, ${fill} ${stop}%, ${fill} 100%)`;
}

export function ganttColorName(color: string): string {
  const red = Number.parseInt(color.slice(1, 3), 16) / 255;
  const green = Number.parseInt(color.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const lightness = (maximum + minimum) / 2;
  const delta = maximum - minimum;
  if (lightness > 0.93) return "白色";
  if (lightness < 0.12) return "黑色";
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.15) return "灰色";
  const hue = maximum === red
    ? 60 * (((green - blue) / delta) % 6)
    : maximum === green
      ? 60 * ((blue - red) / delta + 2)
      : 60 * ((red - green) / delta + 4);
  const normalizedHue = hue < 0 ? hue + 360 : hue;
  if (normalizedHue < 15 || normalizedHue >= 345) return "红色";
  if (normalizedHue < 45) return "橙色";
  if (normalizedHue < 70) return "黄色";
  if (normalizedHue < 165) return "绿色";
  if (normalizedHue < 195) return "青色";
  if (normalizedHue < 255) return "蓝色";
  if (normalizedHue < 290) return "紫色";
  return "粉色";
}

export function ganttGroupAccessibleLabel(group: Pick<TaskGroup, "name" | "color">): string {
  return `${group.name}，${ganttColorName(group.color)}（${group.color.toUpperCase()}）`;
}

export function ganttTaskAppearance(
  task: Pick<GanttTask, "groupId" | "temperature" | "progress" | "isBlocked">,
  groups: readonly TaskGroup[],
  options: { preview?: boolean; critical?: boolean } = {},
): { className: string; style: GanttColorStyle; group: TaskGroup | null } {
  const group = task.groupId ? groups.find((candidate) => candidate.id === task.groupId) ?? null : null;
  const className = [
    options.preview ? "gantt-drag-preview" : "gantt-bar",
    group ? "" : `temperature-${task.temperature}`,
    group ? "gantt-group-colored" : "",
    options.critical ? "is-critical" : "",
    task.isBlocked ? "is-blocked" : "",
  ].filter(Boolean).join(" ");
  const groupProgress = clampedProgress(task.progress);
  const groupGradient = group ? ganttGroupGradient(group.color, groupProgress) : "";
  const style: GanttColorStyle = group
    ? {
        "--task-group-color": group.color,
        "--task-group-fill": lightGroupFill(group.color),
        "--task-group-gradient": groupGradient,
        "--task-group-progress": `${groupProgress}%`,
        background: groupGradient,
      }
    : options.preview
      ? {
          "--gantt-preview-fill": temperatureFills[task.temperature],
          "--gantt-preview-border": temperatureBorders[task.temperature],
        }
      : {};
  return { className, style, group };
}

export function ganttPreviewAppearance(
  task: Pick<GanttTask, "id" | "groupId" | "temperature" | "progress" | "isBlocked">,
  groups: readonly TaskGroup[],
  criticalTaskIds: ReadonlySet<string>,
): ReturnType<typeof ganttTaskAppearance> {
  return ganttTaskAppearance(task, groups, {
    preview: true,
    critical: criticalTaskIds.has(task.id),
  });
}

export async function loadGanttSnapshot(
  api: Pick<LifeOSApi, "getGantt" | "getTaskGroups">,
  start: string,
  end: string,
  goalId: string | undefined,
  previousTasks: GanttTask[] = [],
): Promise<{ data: GanttData; groups: TaskGroup[] }> {
  const ganttRequest = api.getGantt(start, end, goalId);
  const groupsRequest = api.getTaskGroups().catch(() => [] as TaskGroup[]);
  const [loaded, groups] = await Promise.all([ganttRequest, groupsRequest]);
  return {
    data: { ...loaded, tasks: stableGanttTaskOrder(loaded.tasks, previousTasks) },
    groups,
  };
}

export function stableGanttTaskOrder(next: GanttTask[], previous: GanttTask[] = []): GanttTask[] {
  const previousPosition = new Map(previous.map((task, index) => [task.id, index]));
  return next
    .map((task, responseIndex) => ({ task, responseIndex }))
    .sort((left, right) => {
      const rankDifference = left.task.rank - right.task.rank;
      if (rankDifference) return rankDifference;
      const leftPrevious = previousPosition.get(left.task.id);
      const rightPrevious = previousPosition.get(right.task.id);
      if (leftPrevious !== undefined || rightPrevious !== undefined) {
        return (leftPrevious ?? Number.MAX_SAFE_INTEGER) - (rightPrevious ?? Number.MAX_SAFE_INTEGER);
      }
      const createdDifference = left.task.createdAt.localeCompare(right.task.createdAt);
      return createdDifference || left.task.id.localeCompare(right.task.id) || left.responseIndex - right.responseIndex;
    })
    .map(({ task }) => task);
}

export function GanttView({ api, goals, taskRevision, onOpen, onTaskSaved, onToast, onViewChange }: GanttViewProps): ReactElement {
  const today = localDate(new Date());
  const [start, setStart] = useState(addDays(today, -7));
  const [scale, setScale] = useState<Scale>("day");
  const [goalId, setGoalId] = useState("");
  const [data, setData] = useState<GanttData>({ tasks: [], dependencies: [], criticalPath: [] });
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const taskOrderRef = useRef<GanttTask[]>([]);
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const monthWindow = useMemo(() => monthTimelineWindow(start, 180), [start]);
  const rangeStart = scale === "month" ? monthWindow.start : start;
  const rangeEnd = scale === "month" ? monthWindow.end : addDays(start, 42);
  const days = useMemo(() => dateRange(rangeStart, rangeEnd), [rangeEnd, rangeStart]);
  const end = days.at(-1) ?? rangeStart;
  const cellWidth = pixels[scale];
  const previousWindowLabel = scale === "month" ? "向前移动一个月" : "向前移动一周";
  const nextWindowLabel = scale === "month" ? "向后移动一个月" : "向后移动一周";
  const todayWindowLabel = "把时间窗口定位到今天附近";
  const swipeHandlers = useTaskViewSwipe("gantt", onViewChange);
  const usedGroups = useMemo(() => {
    const groupIds = new Set(data.tasks.map((task) => task.groupId).filter(Boolean));
    return groups.filter((group) => groupIds.has(group.id));
  }, [data.tasks, groups]);

  function toggleTask(taskId: string): void {
    setCollapsedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const loaded = await loadGanttSnapshot(api, rangeStart, end, goalId || undefined, taskOrderRef.current);
      taskOrderRef.current = loaded.data.tasks;
      setData(loaded.data);
      setGroups(loaded.groups);
    } catch {
      setError("甘特数据暂时无法读取。");
    } finally {
      setLoading(false);
    }
  }, [api, end, goalId, rangeStart]);

  useEffect(() => {
    void load();
  }, [load, taskRevision]);

  async function moveTask(taskId: string, operation: DragOperation, origin: string, targetDate: string): Promise<void> {
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task || task.isBlocked || !origin) return;
    const delta = dayDifference(origin, targetDate);
    if (!delta) return;
    const timespan = moveTimespan(task.startAt, task.endAt, operation || "move", delta);
    const previous = data;
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => item.id === task.id ? { ...item, ...timespan } : item),
    }));
    try {
      const saved = await api.updateTimespan(task, timespan.startAt, timespan.endAt);
      onTaskSaved(saved);
      onToast("时间轴已保存");
      await load();
    } catch (reason) {
      setData(previous);
      onToast(reason instanceof Error ? reason.message : "调整失败，已恢复原时间");
    }
  }

  return (
    <section
      className="board v02-page gantt-page task-view-page"
      aria-labelledby="task-views-title"
      {...swipeHandlers}
    >
      <header className="v02-page-header">
        <div><p className="eyebrow">任务的时间视图</p><h1 id="task-views-title">视图</h1></div>
        <TaskViewTabs current="gantt" onChange={onViewChange} />
      </header>
      <div
        className="task-view-panel task-view-enter-from-right"
        role="tabpanel"
        id="task-view-panel-gantt"
        aria-labelledby="task-view-tab-gantt"
      >
        <div className="task-view-options gantt-view-options">
        <div className="gantt-filters">
          <select value={goalId} onChange={(event) => setGoalId(event.target.value)} aria-label="按目标筛选">
            <option value="">全部目标</option>
            {goals.filter((goal) => goal.status === "active").map((goal) => <option value={goal.id} key={goal.id}>{goal.title}</option>)}
          </select>
          <div className="view-switcher" role="group" aria-label="缩放级别">
            {(["day", "week", "month"] as Scale[]).map((item) => (
              <button className={scale === item ? "active" : ""} key={item} onClick={() => setScale(item)}>
                {{ day: "日", week: "周", month: "月" }[item]}
              </button>
            ))}
          </div>
        </div>
        </div>
        <div className="gantt-toolbar">
        <button
          className="button button-secondary"
          aria-label={previousWindowLabel}
          title={previousWindowLabel}
          onClick={() => setStart(scale === "month" ? addMonths(start, -1) : addDays(start, -7))}
        >←</button>
        <button
          className="button button-secondary"
          aria-label={todayWindowLabel}
          title={todayWindowLabel}
          onClick={() => setStart(scale === "month" ? today : addDays(today, -7))}
        >回到今天</button>
        <strong>{rangeStart} — {end}</strong>
        <button
          className="button button-secondary"
          aria-label={nextWindowLabel}
          title={nextWindowLabel}
          onClick={() => setStart(scale === "month" ? addMonths(start, 1) : addDays(start, 7))}
        >→</button>
        </div>
        {error && <div className="inline-error"><span>{error}</span><button onClick={() => void load()}>重试</button></div>}
        {loading ? <div className="v02-loading">正在计算关键路径…</div> : data.tasks.length === 0 ? (
        <div className="v02-empty"><span>◌</span><h3>这段时间没有可排程的任务</h3><p>为任务设置计划日或起止日期后会出现在这里。</p></div>
      ) : (
        <GanttChart
          data={data}
          groups={groups}
          days={days}
          cellWidth={cellWidth}
          scale={scale}
          today={today}
          collapsedTaskIds={collapsedTaskIds}
          onToggleCollapse={toggleTask}
          onOpen={onOpen}
          onMove={moveTask}
        />
        )}
        <footer className="gantt-legend">
        {usedGroups.length > 0 && <strong className="gantt-group-legend-title">分组颜色</strong>}
        {usedGroups.map((group) => (
          <span
            className="gantt-group-legend-item"
            key={group.id}
            role="img"
            aria-label={ganttGroupAccessibleLabel(group)}
            title={ganttGroupAccessibleLabel(group)}
          >
            <i
              className="gantt-group-swatch"
              style={{
                "--task-group-color": group.color,
                "--task-group-fill": lightGroupFill(group.color),
              } as GanttColorStyle}
              aria-hidden="true"
            />
            {group.name}
          </span>
        ))}
        {usedGroups.length > 0 && <span>深色为已完成进度，浅色为剩余时段</span>}
        <span><i className="critical" />关键路径</span>
        <span><i className="blocked" />被阻塞</span>
        <span>未分组沿用温度色；拖动中间平移，拖动两端调整起止</span>
        </footer>
      </div>
    </section>
  );
}

interface GanttChartProps {
  data: GanttData;
  groups: TaskGroup[];
  days: string[];
  cellWidth: number;
  scale: Scale;
  today: string;
  collapsedTaskIds: ReadonlySet<string>;
  onToggleCollapse: (taskId: string) => void;
  onOpen: (task: Task) => void;
  onMove: (taskId: string, operation: DragOperation, origin: string, targetDate: string) => Promise<void>;
}

function GanttChart({
  data,
  groups,
  days,
  cellWidth,
  scale,
  today,
  collapsedTaskIds,
  onToggleCollapse,
  onOpen,
  onMove,
}: GanttChartProps): ReactElement {
  const rowHeight = 56;
  const labelWidth = 224;
  const start = days[0]!;
  const width = days.length * cellWidth;
  const monthSegments = useMemo(
    () => scale === "month" ? monthTimelineSegments(days) : [],
    [days, scale],
  );
  const rows = useMemo(
    () => projectGanttTree(data.tasks, collapsedTaskIds),
    [collapsedTaskIds, data.tasks],
  );
  const height = rows.length * rowHeight;
  const critical = new Set(data.criticalPath);
  const byId = new Map(rows.map(({ task }, index) => [task.id, { task, index }]));
  const canvasRef = useRef<HTMLDivElement>(null);
  const htmlDrag = useRef<ActiveGanttDrag | null>(null);
  const previewRef = useRef<GanttDragPreview | null>(null);
  const [preview, setPreview] = useState<GanttDragPreview | null>(null);

  function dragDescriptor(task: GanttTask, rowIndex: number, operation: DragOperation, origin: string): ActiveGanttDrag {
    const taskStart = task.startAt?.slice(0, 10) ?? task.plannedDate?.slice(0, 10) ?? start;
    const taskEnd = task.endAt?.slice(0, 10) ?? task.deadline?.slice(0, 10) ?? taskStart;
    return { task, rowIndex, operation, origin, taskStart, taskEnd };
  }

  function pointerDate(clientX: number, clientY: number): string | null {
    const bounds = canvasRef.current?.getBoundingClientRect();
    const viewport = canvasRef.current?.closest<HTMLElement>(".gantt-scroll")?.getBoundingClientRect();
    if (
      !bounds
      || clientX < Math.max(bounds.left, viewport?.left ?? bounds.left)
      || clientX >= Math.min(bounds.right, viewport?.right ?? bounds.right)
      || clientY < Math.max(bounds.top, viewport?.top ?? bounds.top)
      || clientY >= Math.min(bounds.bottom, viewport?.bottom ?? bounds.bottom)
    ) {
      return null;
    }
    return dateAtHorizontalPointer(clientX, bounds.left, cellWidth, days);
  }

  function showPreview(active: ActiveGanttDrag, targetDate: string | null): void {
    const candidate = ganttDragPreview(
      active.task,
      active.rowIndex,
      active.taskStart,
      active.taskEnd,
      active.operation,
      active.origin,
      targetDate,
    );
    previewRef.current = candidate;
    setPreview(candidate);
  }

  function clearHtmlDrag(): void {
    htmlDrag.current = null;
    previewRef.current = null;
    setPreview(null);
  }

  function commitDrag(active: ActiveGanttDrag, cancelled = false): void {
    const candidate = previewRef.current;
    previewRef.current = null;
    setPreview(null);
    const matches = candidate
      && candidate.taskId === active.task.id
      && candidate.operation === active.operation
      && candidate.origin === active.origin;
    if (!cancelled && matches) {
      void onMove(active.task.id, active.operation, active.origin, candidate.targetDate);
    }
  }
  return (
    <div className="gantt-scroll">
      <div className="gantt-chart" style={{ width: labelWidth + width }}>
        <div className="gantt-corner">任务</div>
        <div className={`gantt-days ${scale === "month" ? "is-month" : ""}`} style={{ left: labelWidth, width }}>
          {scale === "month" ? monthSegments.map((segment) => {
            const containsToday = today >= segment.start && today <= segment.end;
            return (
              <span
                className={containsToday ? "is-today" : ""}
                key={segment.month}
                style={{ width: segment.dayCount * cellWidth }}
                title={`${segment.start} — ${segment.end}`}
                aria-current={containsToday ? "date" : undefined}
              >
                {segment.label}
              </span>
            );
          }) : days.map((day) => (
            <span
              className={day === today ? "is-today" : ""}
              key={day}
              style={{ width: cellWidth }}
              title={day}
              aria-current={day === today ? "date" : undefined}
            >
              {cellWidth >= 18 ? day.slice(8) : Number(day.slice(8)) === 1 ? day.slice(5, 7) : ""}
            </span>
          ))}
        </div>
        <div className="gantt-body" style={{ height }}>
          {rows.map(({ task, depth, hasChildren }, index) => (
            <div className="gantt-label" style={{ top: index * rowHeight, width: labelWidth }} key={`label-${task.id}`}>
              <div className="gantt-label-main" style={{ paddingInlineStart: depth * 16 }}>
                {hasChildren ? (
                  <button
                    type="button"
                    className="gantt-tree-toggle"
                    aria-expanded={!collapsedTaskIds.has(task.id)}
                    aria-label={`${collapsedTaskIds.has(task.id) ? "展开" : "折叠"}${task.title}的子任务`}
                    onClick={() => onToggleCollapse(task.id)}
                  >
                    {collapsedTaskIds.has(task.id) ? "›" : "⌄"}
                  </button>
                ) : <span className="gantt-tree-spacer" aria-hidden="true" />}
                <button className="gantt-task-link" onClick={() => onOpen(task)} title={task.title}>{task.title}</button>
              </div>
              <small>{task.isBlocked ? "🔒 等待前置" : `${task.progress}%`}</small>
            </div>
          ))}
          <div
            ref={canvasRef}
            className="gantt-canvas"
            style={{ left: labelWidth, width, height }}
            onDragOver={(event) => {
              const active = htmlDrag.current;
              if (!active) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              showPreview(active, pointerDate(event.clientX, event.clientY));
            }}
            onDragLeave={(event) => {
              const nextTarget = event.relatedTarget;
              if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
              if (htmlDrag.current) showPreview(htmlDrag.current, null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const active = htmlDrag.current;
              htmlDrag.current = null;
              if (active) commitDrag(active);
              else clearHtmlDrag();
            }}
          >
            {rows.map(({ task }, index) => (
              <span
                className="gantt-row-guide"
                key={`guide-${task.id}`}
                style={{ top: index * rowHeight, width, height: rowHeight }}
              />
            ))}
            {days.includes(today) && (
              <span
                className="gantt-today-marker"
                style={{ left: (dayDifference(start, today) + 0.5) * cellWidth }}
                title={`今天 ${today}`}
                aria-hidden="true"
              />
            )}
            <svg className="gantt-links" width={width} height={height} aria-label="任务依赖关系">
              <defs><marker id="gantt-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>
              {data.dependencies.map((dependency) => {
                const from = byId.get(dependency.predecessorId);
                const to = byId.get(dependency.successorId);
                if (!from || !to) return null;
                const fromEnd = from.task.endAt?.slice(0, 10) ?? from.task.deadline?.slice(0, 10) ?? start;
                const toStart = to.task.startAt?.slice(0, 10) ?? to.task.plannedDate?.slice(0, 10) ?? start;
                const x1 = (dayDifference(start, fromEnd) + 1) * cellWidth;
                const x2 = dayDifference(start, toStart) * cellWidth;
                const y1 = from.index * rowHeight + rowHeight / 2;
                const y2 = to.index * rowHeight + rowHeight / 2;
                return <path key={dependency.id} d={`M${x1},${y1} C${x1 + 18},${y1} ${x2 - 18},${y2} ${x2},${y2}`} markerEnd="url(#gantt-arrow)" />;
              })}
            </svg>
            {preview && (() => {
              const previewTask = byId.get(preview.taskId)?.task;
              if (!previewTask) return null;
              const appearance = ganttPreviewAppearance(previewTask, groups, critical);
              return (
                <div
                  className={appearance.className}
                  style={{
                    ...appearance.style,
                    left: dayDifference(start, preview.startDate) * cellWidth,
                    top: preview.rowIndex * rowHeight + 11,
                    width: Math.max(cellWidth, preview.dayCount * cellWidth),
                    height: 34,
                  }}
                  aria-hidden="true"
                >
                  <span>{preview.label}</span>
                </div>
              );
            })()}
            <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {preview ? `预计时间 ${preview.label}` : ""}
            </span>
            {rows.map(({ task }, index) => (
              <GanttBar
                key={task.id}
                task={task}
                index={index}
                start={start}
                cellWidth={cellWidth}
                rowHeight={rowHeight}
                critical={critical.has(task.id)}
                groups={groups}
                onOpen={onOpen}
                onCommit={onMove}
                onHtmlDragStart={(event, operation, origin) => {
                  if (task.isBlocked) return;
                  setDragData(event, task, operation, origin);
                  const active = dragDescriptor(task, index, operation, origin);
                  htmlDrag.current = active;
                  showPreview(active, origin);
                }}
                onHtmlDragEnd={clearHtmlDrag}
                onPointerPreview={(operation, origin, clientX, clientY) => {
                  const active = dragDescriptor(task, index, operation, origin);
                  showPreview(active, pointerDate(clientX, clientY));
                }}
                onPointerFinish={(operation, origin, cancelled) => {
                  const active = dragDescriptor(task, index, operation, origin);
                  commitDrag(active, cancelled);
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function setDragData(event: DragEvent, task: GanttTask, operation: DragOperation, origin: string): void {
  event.dataTransfer.setData("text/task-id", task.id);
  event.dataTransfer.setData("text/gantt-operation", operation);
  event.dataTransfer.setData("text/gantt-origin", origin);
  event.dataTransfer.effectAllowed = "move";
}

function GanttBar({
  task,
  index,
  start,
  cellWidth,
  rowHeight,
  critical,
  groups,
  onOpen,
  onCommit,
  onHtmlDragStart,
  onHtmlDragEnd,
  onPointerPreview,
  onPointerFinish,
}: {
  task: GanttTask;
  index: number;
  start: string;
  cellWidth: number;
  rowHeight: number;
  critical: boolean;
  groups: TaskGroup[];
  onOpen: (task: Task) => void;
  onCommit: (taskId: string, operation: DragOperation, origin: string, targetDate: string) => Promise<void>;
  onHtmlDragStart: (event: DragEvent, operation: DragOperation, origin: string) => void;
  onHtmlDragEnd: () => void;
  onPointerPreview: (
    operation: DragOperation,
    origin: string,
    clientX: number,
    clientY: number,
  ) => void;
  onPointerFinish: (
    operation: DragOperation,
    origin: string,
    cancelled: boolean,
  ) => void;
}): ReactElement {
  const taskStart = task.startAt?.slice(0, 10) ?? task.plannedDate?.slice(0, 10) ?? start;
  const taskEnd = task.endAt?.slice(0, 10) ?? task.deadline?.slice(0, 10) ?? taskStart;
  const left = dayDifference(start, taskStart) * cellWidth;
  const duration = Math.max(1, dayDifference(taskStart, taskEnd) + 1);
  const pointerDrag = useRef<{
    pointerId: number;
    operation: DragOperation;
    origin: string;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const [touchDragging, setTouchDragging] = useState(false);
  const ignoreClickUntil = useRef(0);
  const appearance = ganttTaskAppearance(task, groups, { critical });
  const groupHint = appearance.group
    ? `｜分组 ${ganttGroupAccessibleLabel(appearance.group)}`
    : "";

  function startPointer(
    event: ReactPointerEvent<HTMLElement>,
    operation: DragOperation,
    origin: string,
  ): void {
    if (task.isBlocked || event.pointerType === "mouse" || !event.isPrimary) return;
    pointerDrag.current = {
      pointerId: event.pointerId,
      operation,
      origin,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePointer(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active && passedPointerDragThreshold(drag.startX, drag.startY, event.clientX, event.clientY)) {
      drag.active = true;
      setTouchDragging(true);
    }
    if (!drag.active) return;
    event.preventDefault();
    onPointerPreview(drag.operation, drag.origin, event.clientX, event.clientY);
    const scroller = event.currentTarget.closest<HTMLElement>(".gantt-scroll");
    const bounds = scroller?.getBoundingClientRect();
    if (bounds && event.clientX < bounds.left + 36) scroller?.scrollBy({ left: -18 });
    if (bounds && event.clientX > bounds.right - 36) scroller?.scrollBy({ left: 18 });
  }

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>, cancelled = false): void {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    pointerDrag.current = null;
    setTouchDragging(false);
    if (drag.active) ignoreClickUntil.current = Date.now() + 400;
    onPointerFinish(
      drag.operation,
      drag.origin,
      cancelled || !drag.active,
    );
  }

  function keyboardNudge(event: ReactKeyboardEvent, operation: DragOperation, origin: string): void {
    if (task.isBlocked || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    void onCommit(task.id, operation, origin, addDays(origin, event.key === "ArrowLeft" ? -1 : 1));
  }
  return (
    <div
      className={`${appearance.className} ${touchDragging ? "is-touch-dragging" : ""}`}
      style={{ ...appearance.style, left, top: index * rowHeight + 11, width: Math.max(cellWidth, duration * cellWidth), height: 34 }}
      title={task.isBlocked ? `${task.title}：前置任务未完成${groupHint}` : `${task.title}｜${taskStart} — ${taskEnd}${groupHint}`}
      role="group"
      aria-label={`${task.title}，${taskStart} 到 ${taskEnd}${appearance.group ? `，分组 ${ganttGroupAccessibleLabel(appearance.group)}` : ""}${task.isBlocked ? "，已阻塞不可调整" : "，可拖动平移；按回车打开详情"}`}
      aria-disabled={task.isBlocked}
      tabIndex={0}
      draggable={!task.isBlocked}
      onClick={(event) => {
        if (Date.now() < ignoreClickUntil.current) return;
        if (event.target instanceof HTMLElement && event.target.closest(".gantt-handle")) return;
        onOpen(task);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        onOpen(task);
      }}
      onDragStart={(event) => onHtmlDragStart(event, "move", taskStart)}
      onDragEnd={onHtmlDragEnd}
      onPointerDown={(event) => startPointer(event, "move", taskStart)}
      onPointerMove={movePointer}
      onPointerUp={(event) => finishPointer(event)}
      onPointerCancel={(event) => finishPointer(event, true)}
      onLostPointerCapture={(event) => finishPointer(event, true)}
    >
      <button
        type="button"
        className="gantt-handle start"
        draggable={!task.isBlocked}
        disabled={task.isBlocked}
        aria-label={`调整 ${task.title} 的开始日期，当前 ${taskStart}`}
        onDragStart={(event) => {
          event.stopPropagation();
          onHtmlDragStart(event, "start", taskStart);
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          startPointer(event, "start", taskStart);
        }}
        onKeyDown={(event) => keyboardNudge(event, "start", taskStart)}
      />
      {!appearance.group && <i style={{ width: `${clampedProgress(task.progress)}%` }} />}
      <button
        type="button"
        className="gantt-handle end"
        draggable={!task.isBlocked}
        disabled={task.isBlocked}
        aria-label={`调整 ${task.title} 的结束日期，当前 ${taskEnd}`}
        onDragStart={(event) => {
          event.stopPropagation();
          onHtmlDragStart(event, "end", taskEnd);
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
          startPointer(event, "end", taskEnd);
        }}
        onKeyDown={(event) => keyboardNudge(event, "end", taskEnd)}
      />
    </div>
  );
}
