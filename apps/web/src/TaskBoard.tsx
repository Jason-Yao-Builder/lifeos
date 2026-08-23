import { useEffect, useMemo, useState } from "react";
import type { DragEvent, FormEvent, ReactElement } from "react";
import type { CreateTask, Task, TaskStatus, Temperature, UpdateTask } from "./types";
import {
  formatLongDate,
  formatShortDate,
  openDatePicker,
  statusLabels,
  statusTransitions,
  temperatureLabels,
  todayKey,
} from "./utils";

export interface TaskFilters {
  temperature: "all" | Temperature;
  status: "all" | TaskStatus;
  tag: string;
}

interface TaskBoardProps {
  view: "tasks" | "today";
  tasks: Task[];
  filters: TaskFilters;
  tags: string[];
  onFiltersChange: (filters: TaskFilters) => void;
  onAdd: (input: CreateTask) => Promise<void>;
  onUpdate: (task: Task, patch: UpdateTask) => Promise<void>;
  onOpen: (task: Task) => void;
  onReorder: (sourceId: string, targetId: string) => Promise<void>;
  onGenerateSummary: () => Promise<void>;
  generatingSummary: boolean;
}

function QuickAdd({
  view,
  onAdd,
}: Pick<TaskBoardProps, "view" | "onAdd">): ReactElement {
  const [title, setTitle] = useState("");
  const [temperature, setTemperature] = useState<Temperature>(
    view === "today" ? "hot" : "warm",
  );
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setTemperature(view === "today" ? "hot" : "warm");
  }, [view]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim()) {
      setInvalid(true);
      return;
    }
    setSaving(true);
    try {
      await onAdd({
        title: title.trim(),
        temperature,
        deadline: deadline || null,
        plannedDate: view === "today" ? todayKey() : null,
      });
      setTitle("");
      setDeadline("");
      setInvalid(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={`quick-add ${invalid ? "is-invalid" : ""}`} onSubmit={submit}>
      <span className="quick-add-plus" aria-hidden="true">＋</span>
      <input
        aria-label="新任务标题"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          if (event.target.value.trim()) setInvalid(false);
        }}
        placeholder={view === "today" ? "今天还要完成什么？" : "记下一件事…"}
      />
      <select
        aria-label="新任务温度"
        className={`temperature-select temperature-${temperature}`}
        value={temperature}
        onChange={(event) => setTemperature(event.target.value as Temperature)}
      >
        {Object.entries(temperatureLabels).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <label className="quick-date">
        <span>截止</span>
        <input
          aria-label="新任务截止日"
          type="date"
          value={deadline}
          onClick={(event) => openDatePicker(event.currentTarget)}
          onChange={(event) => setDeadline(event.target.value)}
        />
      </label>
      <button className="button button-primary" disabled={saving} type="submit">
        {saving ? "添加中…" : "添加"}
      </button>
      {invalid && <span className="field-error">先写下任务名称</span>}
    </form>
  );
}

interface TaskRowProps {
  task: Task;
  canReorder: boolean;
  onUpdate: TaskBoardProps["onUpdate"];
  onOpen: TaskBoardProps["onOpen"];
  onDragStart: (event: DragEvent, id: string) => void;
  onDrop: (event: DragEvent, id: string) => void;
}

function TaskRow({
  task,
  canReorder,
  onUpdate,
  onOpen,
  onDragStart,
  onDrop,
}: TaskRowProps): ReactElement {
  const done = task.status === "completed" || task.status === "archived";
  const actionStatus = task.status === "todo"
    ? "in_progress"
    : task.status === "in_progress"
      ? "completed"
      : task.status === "completed" || task.status === "archived"
        ? "todo"
        : task.status === "abandoned"
          ? "archived"
        : null;
  return (
    <article
      className={`task-row ${done ? "is-complete" : ""}`}
      draggable={canReorder}
      onDragStart={(event) => onDragStart(event, task.id)}
      onDragOver={(event) => {
        if (canReorder) event.preventDefault();
      }}
      onDrop={(event) => onDrop(event, task.id)}
    >
      <button
        type="button"
        className="drag-handle"
        aria-label={canReorder ? `拖动排序：${task.title}` : "清除筛选后可排序"}
        title={canReorder ? "拖动排序" : "清除筛选后可排序"}
      >
        ⋮⋮
      </button>
      <button
        type="button"
        className={`complete-toggle ${done ? "checked" : ""}`}
        aria-label={
          task.status === "todo"
            ? "开始任务"
            : task.status === "completed" || task.status === "archived"
              ? "恢复到待办"
              : task.status === "abandoned"
                ? "归档任务"
                : "标记为已完成"
        }
        title={task.status === "completed" || task.status === "archived" ? "恢复到待办" : undefined}
        disabled={!actionStatus}
        onClick={() => actionStatus && void onUpdate(task, { status: actionStatus })}
      >
        {task.status === "completed" || task.status === "archived"
          ? "↺"
          : task.status === "todo"
            ? ""
            : "·"}
      </button>
      <button type="button" className="task-summary" onClick={() => onOpen(task)}>
        <span className="task-title-line">
          <strong>{task.title}</strong>
          {task.hardness === "hard" && <span className="hard-mark" title="硬任务">◆</span>}
        </span>
        <span className="task-meta">
          {task.tags.length > 0 ? (
            task.tags.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)
          ) : (
            <span className="muted">无标签</span>
          )}
          {task.deadline && <span className="deadline">截止 {formatShortDate(task.deadline)}</span>}
        </span>
      </button>
      <select
        aria-label={`${task.title}的温度`}
        className={`inline-select temperature-${task.temperature}`}
        value={task.temperature}
        onChange={(event) =>
          void onUpdate(task, { temperature: event.target.value as Temperature })
        }
      >
        {Object.entries(temperatureLabels).map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
      <select
        aria-label={`${task.title}的状态`}
        className="inline-select status-select"
        value={task.status}
        onChange={(event) =>
          void onUpdate(task, { status: event.target.value as TaskStatus })
        }
      >
        {[task.status, ...statusTransitions[task.status]].map((value) => (
          <option key={value} value={value}>{statusLabels[value]}</option>
        ))}
      </select>
      <label className="inline-date">
        <span>计划日</span>
        <input
          aria-label={`${task.title}的计划日`}
          type="date"
          value={task.plannedDate?.slice(0, 10) ?? ""}
          onClick={(event) => openDatePicker(event.currentTarget)}
          onChange={(event) => void onUpdate(task, { plannedDate: event.target.value || null })}
        />
      </label>
      <span className="score" title="综合优先分">
        {task.score === null ? "—" : task.score}
      </span>
    </article>
  );
}

export function TaskBoard(props: TaskBoardProps): ReactElement {
  const {
    view,
    tasks,
    filters,
    tags,
    onFiltersChange,
    onAdd,
    onUpdate,
    onOpen,
    onReorder,
    onGenerateSummary,
    generatingSummary,
  } = props;
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const visibleTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          (filters.temperature === "all" || task.temperature === filters.temperature) &&
          (filters.status === "all" || task.status === filters.status) &&
          (!filters.tag || task.tags.includes(filters.tag)),
      ),
    [filters, tasks],
  );
  const filterActive =
    filters.temperature !== "all" || filters.status !== "all" || Boolean(filters.tag);
  const canReorder = view === "tasks" && !filterActive;
  const completed = tasks.filter((task) => task.status === "completed").length;
  const completion = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;

  function drop(event: DragEvent, targetId: string): void {
    event.preventDefault();
    if (draggingId && draggingId !== targetId) {
      void onReorder(draggingId, targetId);
    }
    setDraggingId(null);
  }

  return (
    <section className="board">
      <header className="board-header">
        <div>
          <p className="eyebrow">{view === "today" ? formatLongDate() : "当前全景"}</p>
          <h1>{view === "today" ? "今天" : "任务"}</h1>
          <p className="board-subtitle">
            {view === "today"
              ? `完成 ${completed} / ${tasks.length}，把注意力留给当下`
              : `共 ${tasks.length} 项，${tasks.filter((task) => task.temperature === "hot").length} 项正在热区`}
          </p>
        </div>
        {view === "today" && (
          <div className="today-progress" aria-label={`今日完成度 ${completion}%`}>
            <div className="progress-copy">
              <strong>{completion}%</strong>
              <span>今日完成度</span>
            </div>
            <div className="progress-track"><span style={{ width: `${completion}%` }} /></div>
          </div>
        )}
      </header>

      <QuickAdd view={view} onAdd={onAdd} />

      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">筛选</span>
          <select
            aria-label="按温度筛选"
            value={filters.temperature}
            onChange={(event) =>
              onFiltersChange({ ...filters, temperature: event.target.value as TaskFilters["temperature"] })
            }
          >
            <option value="all">全部温度</option>
            {Object.entries(temperatureLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            aria-label="按状态筛选"
            value={filters.status}
            onChange={(event) =>
              onFiltersChange({ ...filters, status: event.target.value as TaskFilters["status"] })
            }
          >
            <option value="all">全部状态</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            aria-label="按标签筛选"
            value={filters.tag}
            onChange={(event) => onFiltersChange({ ...filters, tag: event.target.value })}
          >
            <option value="">全部标签</option>
            {tags.map((tag) => <option key={tag} value={tag}>#{tag}</option>)}
          </select>
          {filterActive && (
            <button
              className="text-button"
              type="button"
              onClick={() => onFiltersChange({ temperature: "all", status: "all", tag: "" })}
            >
              清除筛选
            </button>
          )}
        </div>
        <span className="result-count">{visibleTasks.length} 项</span>
      </div>

      {visibleTasks.length > 0 ? (
        <div className="task-list">
          <div className="task-list-head" aria-hidden="true">
            <span />
            <span />
            <span>任务</span>
            <span>温度</span>
            <span>状态</span>
            <span>日期</span>
            <span>分数</span>
          </div>
          {visibleTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              canReorder={canReorder}
              onUpdate={onUpdate}
              onOpen={onOpen}
              onDragStart={(event, id) => {
                setDraggingId(id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", id);
              }}
              onDrop={drop}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-symbol" aria-hidden="true">{filterActive ? "◌" : "✓"}</span>
          <h2>{filterActive ? "没有匹配的任务" : view === "today" ? "今天还没有安排" : "从第一件事开始"}</h2>
          <p>
            {filterActive
              ? "试试清除筛选，或者改用更宽的条件。"
              : view === "today"
                ? "在上方写下今天真正要完成的事。"
                : "不用先想完整，记下来就是起点。"}
          </p>
          {filterActive && (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => onFiltersChange({ temperature: "all", status: "all", tag: "" })}
            >
              清除筛选
            </button>
          )}
        </div>
      )}

      {view === "today" && tasks.length > 0 && (
        <aside className="summary-prompt">
          <div>
            <span className="summary-orb" aria-hidden="true">∗</span>
            <div>
              <strong>将今天收好</strong>
              <p>AI 会基于今日的执行与变更，生成一张可编辑的小结卡。</p>
            </div>
          </div>
          <button
            type="button"
            className="button button-dark"
            disabled={generatingSummary}
            onClick={() => void onGenerateSummary()}
          >
            {generatingSummary ? "正在整理…" : "生成今日小结"}
          </button>
        </aside>
      )}
    </section>
  );
}
