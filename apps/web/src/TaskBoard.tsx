import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DragEvent,
  FormEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from "react";
import type { CreateTask, Task, TaskScoreDimensions, TaskStatus, Temperature, UpdateTask } from "./types";
import {
  matchesTagKeyword,
  matchesTaskTimeFilter,
  passedPointerDragThreshold,
  taskDropPosition,
  taskHierarchyReorderAnchor,
  taskQueueGroup,
  taskRowsByRank,
  taskTargetDate,
  taskTreeRows,
  visibleTaskTreeRows,
} from "./v02-utils";
import type { TaskDropPosition, TaskQueueGroupKey, TaskTimeFilter } from "./v02-utils";
import {
  calculateCompositeScore,
  clampScoreDimension,
  formatLongDate,
  formatShortDate,
  mergeTags,
  openDatePicker,
  shouldCommitTagKey,
  statusLabels,
  statusTransitions,
  temperatureLabels,
  todayKey,
} from "./utils";

function sameScoreDimensions(
  left: TaskScoreDimensions | null | undefined,
  right: TaskScoreDimensions,
): boolean {
  return Boolean(left) && scoreDimensionFields.every(({ key }) => left?.[key] === right[key]);
}

const defaultScoreDimensions: TaskScoreDimensions = {
  impact: 50,
  urgency: 50,
  alignment: 50,
  effort: 50,
};

const scoreDimensionFields: Array<{
  key: keyof TaskScoreDimensions;
  label: string;
  hint: string;
}> = [
  { key: "impact", label: "影响力", hint: "对结果的影响" },
  { key: "urgency", label: "紧迫度", hint: "时间压力" },
  { key: "alignment", label: "方向一致性", hint: "与长期方向一致" },
  { key: "effort", label: "精力成本", hint: "仅作元数据，不参与评分" },
];

export type ScoreDimensionDraft = {
  [Key in keyof TaskScoreDimensions]: number | "";
};

export function createScoreDimensionDraft(
  dimensions: TaskScoreDimensions,
): ScoreDimensionDraft {
  return { ...dimensions };
}

export function parseScoreDimensionDraftValue(
  rawValue: string,
  valueAsNumber: number,
): number | "" {
  return rawValue === "" ? "" : clampScoreDimension(valueAsNumber);
}

export function normalizeScoreDimensionDraft(
  draft: ScoreDimensionDraft,
): TaskScoreDimensions | null {
  if (
    draft.impact === "" ||
    draft.urgency === "" ||
    draft.alignment === "" ||
    draft.effort === ""
  ) return null;
  return {
    impact: draft.impact,
    urgency: draft.urgency,
    alignment: draft.alignment,
    effort: draft.effort,
  };
}

export interface TaskFilters {
  temperature: "all" | Temperature;
  status: "all" | TaskStatus;
  tag: string;
  time: TaskTimeFilter;
}

const queueGroups: Array<{ key: TaskQueueGroupKey; label: string }> = [
  { key: "overdue", label: "已逾期" },
  { key: "due_today", label: "今日截止" },
  { key: "future", label: "未来截止" },
  { key: "unscheduled", label: "无截止安排" },
  { key: "completed_today", label: "今日已完成" },
  { key: "completed_past", label: "历史完成" },
  { key: "other_terminal", label: "其他终态" },
];

interface TaskBoardProps {
  view: "tasks" | "today";
  tasks: Task[];
  filters: TaskFilters;
  tags: string[];
  onViewChange: (view: "tasks" | "today") => void;
  onFiltersChange: (filters: TaskFilters) => void;
  onAdd: (input: CreateTask) => Promise<void>;
  onUpdate: (task: Task, patch: UpdateTask) => Promise<void>;
  onOpen: (task: Task) => void;
  onReorder: (
    sourceId: string,
    targetId: string,
    position: TaskDropPosition,
    scopeIds: string[],
  ) => Promise<void>;
}

interface QuickAddDraft {
  title: string;
  description: string;
  temperature: Temperature;
  deadline: string;
  tags: string[];
  tagInput: string;
  manualScore: boolean;
  scoreDimensions: TaskScoreDimensions;
}

export function buildQuickTaskInput(
  view: TaskBoardProps["view"],
  draft: QuickAddDraft,
): CreateTask {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    temperature: draft.temperature,
    deadline: draft.deadline || null,
    plannedDate: view === "today" ? todayKey() : null,
    tags: mergeTags(draft.tags, draft.tagInput),
    ...(draft.manualScore ? { scoreDimensions: draft.scoreDimensions } : {}),
  };
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
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [manualScore, setManualScore] = useState(false);
  const [scoreDraft, setScoreDraft] = useState<ScoreDimensionDraft>(() =>
    createScoreDimensionDraft(defaultScoreDimensions),
  );
  const [saving, setSaving] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setTemperature(view === "today" ? "hot" : "warm");
  }, [view]);

  function commitTags(): void {
    if (!tagInput.trim()) return;
    setTags((current) => mergeTags(current, tagInput));
    setTagInput("");
  }

  function handleTagKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const isComposing = event.nativeEvent.isComposing;
    if (!shouldCommitTagKey(event.key, isComposing)) return;
    event.preventDefault();
    commitTags();
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim()) {
      setInvalid(true);
      return;
    }
    const normalizedScore = normalizeScoreDimensionDraft(scoreDraft);
    if (manualScore && !normalizedScore) return;
    setSaving(true);
    try {
      await onAdd(buildQuickTaskInput(view, {
        title,
        description,
        temperature,
        deadline,
        tags,
        tagInput,
        manualScore,
        scoreDimensions: normalizedScore ?? defaultScoreDimensions,
      }));
      setTitle("");
      setDescription("");
      setDeadline("");
      setTags([]);
      setTagInput("");
      setAdvancedOpen(false);
      setManualScore(false);
      setScoreDraft(createScoreDimensionDraft(defaultScoreDimensions));
      setInvalid(false);
    } catch {
      // The caller owns the error message; keeping this state preserves the full draft.
    } finally {
      setSaving(false);
    }
  }

  const scorePreview = normalizeScoreDimensionDraft(scoreDraft);

  return (
    <form className={`quick-add ${advancedOpen ? "has-advanced" : ""} ${invalid ? "is-invalid" : ""}`} onSubmit={submit}>
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
      <label
        className="quick-date"
        onPointerDown={(event) => {
          const input = event.currentTarget.querySelector("input");
          if (input?.showPicker) event.preventDefault();
        }}
        onClick={(event) => {
          const input = event.currentTarget.querySelector("input");
          if (input?.showPicker) {
            event.preventDefault();
            openDatePicker(input);
          }
        }}
      >
        <span>截止</span>
        <input
          aria-label="新任务截止日"
          type="date"
          value={deadline}
          onChange={(event) => setDeadline(event.target.value)}
        />
      </label>
      <button className="button button-primary" disabled={saving} type="submit">
        {saving ? "添加中…" : "添加"}
      </button>
      <button
        type="button"
        className="quick-advanced-toggle"
        aria-expanded={advancedOpen}
        aria-controls="quick-add-advanced"
        onClick={() => setAdvancedOpen((current) => !current)}
      >
        高级选项 <span aria-hidden="true">⌄</span>
      </button>
      <div className="quick-tag-editor" aria-label="新任务标签">
        {tags.length > 0 && (
          <div className="tag-chips" aria-label="已添加的新任务标签">
            {tags.map((tag) => (
              <span className="tag-chip" key={tag}>
                #{tag}
                <button
                  type="button"
                  aria-label={`移除新任务标签 ${tag}`}
                  onClick={() => setTags((current) => current.filter((item) => item !== tag))}
                >×</button>
              </span>
            ))}
          </div>
        )}
        <div className="quick-tag-entry">
          <input
            aria-label="添加新任务标签"
            value={tagInput}
            disabled={tags.length >= 50}
            placeholder="输入标签后按 Enter 添加"
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={handleTagKeyDown}
          />
        </div>
        <small aria-live="polite">{tags.length}/50</small>
      </div>
      {advancedOpen && (
        <section id="quick-add-advanced" className="quick-advanced" aria-label="新任务高级选项">
          <label className="quick-description" htmlFor="new-task-description">
            <span>描述</span>
            <textarea
              id="new-task-description"
              rows={3}
              maxLength={10_000}
              value={description}
              placeholder="补充背景、完成标准或下一步…"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <header>
            <div>
              <strong>优先级评分</strong>
              <small>不启用时由系统自动评分</small>
            </div>
            <label className="manual-score-toggle">
              <input
                type="checkbox"
                checked={manualScore}
                onChange={(event) => setManualScore(event.target.checked)}
              />
              手动设定
            </label>
          </header>
          <fieldset className="score-dimension-grid" disabled={!manualScore}>
            <legend className="sr-only">三维评分与精力成本元数据，每项范围为 0 到 100</legend>
            {scoreDimensionFields.map(({ key, label, hint }) => (
              <label key={key} htmlFor={`new-task-score-${key}`}>
                <span>{label}</span>
                <small id={`new-task-score-${key}-hint`}>{hint}</small>
                <input
                  id={`new-task-score-${key}`}
                  aria-describedby={`new-task-score-${key}-hint`}
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  required
                  value={scoreDraft[key]}
                  onChange={(event) => {
                    const value = parseScoreDimensionDraftValue(
                      event.currentTarget.value,
                      event.currentTarget.valueAsNumber,
                    );
                    setScoreDraft((current) => ({ ...current, [key]: value }));
                  }}
                />
              </label>
            ))}
          </fieldset>
          <footer className={manualScore ? "active" : ""} aria-live="polite">
            <span>{manualScore ? "综合分预览" : "自动评分将在创建后生成"}</span>
            {manualScore && (
              <strong>{scorePreview ? calculateCompositeScore(scorePreview) : "—"}</strong>
            )}
          </footer>
        </section>
      )}
      {invalid && <span className="field-error">先写下任务名称</span>}
    </form>
  );
}

interface TaskRowProps {
  task: Task;
  depth: number;
  ancestorTitles: string[];
  lineageIssue: "missing" | "cycle" | null;
  hasChildren: boolean;
  childrenExpanded: boolean;
  canReorder: boolean;
  dragging: boolean;
  dropPosition: TaskDropPosition | null;
  onUpdate: TaskBoardProps["onUpdate"];
  onOpen: TaskBoardProps["onOpen"];
  onToggleChildren: (taskId: string) => void;
  onDragStart: (event: DragEvent, id: string) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent, id: string) => void;
  onDrop: (event: DragEvent, id: string) => void;
  onPointerStart: (event: ReactPointerEvent<HTMLButtonElement>, id: string) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerEnd: (event: ReactPointerEvent<HTMLButtonElement>, cancelled?: boolean) => void;
  onKeyboardReorder: (event: KeyboardEvent<HTMLButtonElement>, id: string) => void;
}

function TaskRow({
  task,
  depth,
  ancestorTitles,
  lineageIssue,
  hasChildren,
  childrenExpanded,
  canReorder,
  dragging,
  dropPosition,
  onUpdate,
  onOpen,
  onToggleChildren,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onPointerStart,
  onPointerMove,
  onPointerEnd,
  onKeyboardReorder,
}: TaskRowProps): ReactElement {
  const done = task.status === "completed" || task.status === "archived";
  const [scoreEditorOpen, setScoreEditorOpen] = useState(false);
  const [scoreDraft, setScoreDraft] = useState<ScoreDimensionDraft>(
    createScoreDimensionDraft(task.scoreDimensions ?? defaultScoreDimensions),
  );
  const [scoreSaving, setScoreSaving] = useState(false);
  const [pendingScore, setPendingScore] = useState<{
    dimensions: TaskScoreDimensions;
    version: number;
  } | null>(null);
  const targetDate = taskTargetDate(task);
  const ancestorPath = ancestorTitles.join(" › ");
  const lineageWarning = lineageIssue === "missing"
    ? "归属路径不完整"
    : lineageIssue === "cycle"
      ? "归属关系存在循环"
      : "";
  const actionStatus = task.status === "todo"
    ? "in_progress"
    : task.status === "in_progress"
      ? "completed"
      : task.status === "completed" || task.status === "archived"
        ? "todo"
        : task.status === "abandoned"
          ? "archived"
        : null;

  useEffect(() => {
    if (
      pendingScore &&
      task.version > pendingScore.version &&
      sameScoreDimensions(task.scoreDimensions, pendingScore.dimensions)
    ) {
      setPendingScore(null);
      setScoreEditorOpen(false);
    }
  }, [pendingScore, task.scoreDimensions, task.version]);

  function openScoreEditor(): void {
    setScoreDraft(createScoreDimensionDraft(task.scoreDimensions ?? defaultScoreDimensions));
    setPendingScore(null);
    setScoreEditorOpen(true);
  }

  function cancelScoreEdit(): void {
    setScoreDraft(createScoreDimensionDraft(task.scoreDimensions ?? defaultScoreDimensions));
    setPendingScore(null);
    setScoreEditorOpen(false);
  }

  async function saveScore(event: FormEvent): Promise<void> {
    event.preventDefault();
    const requested = normalizeScoreDimensionDraft(scoreDraft);
    if (!requested) return;
    setScoreSaving(true);
    setPendingScore({ dimensions: requested, version: task.version });
    try {
      await onUpdate(task, { scoreDimensions: requested });
    } catch {
      // The parent reports the failure; this editor intentionally retains the draft.
    } finally {
      setScoreSaving(false);
    }
  }

  const scorePreview = normalizeScoreDimensionDraft(scoreDraft);

  return (
    <article
      className={`task-row task-depth-${depth} ${hasChildren ? "has-children" : ""} ${done ? "is-complete" : ""} ${dragging ? "is-dragging" : ""} ${dropPosition ? `is-drop-${dropPosition}` : ""} ${scoreEditorOpen ? "score-editor-open" : ""}`}
      data-task-drop-id={task.id}
      data-task-target-date={targetDate ?? undefined}
      role="treeitem"
      aria-level={depth}
      aria-label={`${task.title}${ancestorPath ? `，隶属 ${ancestorPath}` : ""}${lineageWarning ? `，${lineageWarning}` : ""}${targetDate ? `，目标日期 ${targetDate}` : ""}`}
      draggable={canReorder && !scoreEditorOpen}
      onDragStart={(event) => onDragStart(event, task.id)}
      onDragEnd={onDragEnd}
      onDragOver={(event) => onDragOver(event, task.id)}
      onDrop={(event) => onDrop(event, task.id)}
    >
      <button
        type="button"
        className="drag-handle"
        aria-label={canReorder ? `拖动排序：${task.title}` : "清除筛选后可排序"}
        title={canReorder ? "拖动排序；方向键微调，Home/End 移到首尾" : "清除筛选后可排序"}
        onPointerDown={(event) => onPointerStart(event, task.id)}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => onPointerEnd(event)}
        onPointerCancel={(event) => onPointerEnd(event, true)}
        onKeyDown={(event) => onKeyboardReorder(event, task.id)}
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
        {task.status === "todo" || done ? "" : "·"}
      </button>
      <button type="button" className="task-summary" onClick={() => onOpen(task)}>
        <span className="task-title-line">
          <strong>{task.title}</strong>
          {task.hardness === "hard" && <span className="hard-mark" title="硬任务">◆</span>}
        </span>
        <span className="task-meta">
          {ancestorPath && <span className="task-parent-context" title={`隶属：${ancestorPath}`}>隶属：{ancestorPath}</span>}
          {lineageWarning && <span className="task-lineage-warning">{lineageWarning}</span>}
          {task.tags.length > 0 ? (
            task.tags.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)
          ) : (
            <span className="muted">无标签</span>
          )}
          {task.deadline && <span className="deadline">截止 {formatShortDate(task.deadline)}</span>}
        </span>
      </button>
      {hasChildren && (
        <button
          type="button"
          className="task-children-toggle"
          aria-label={`${childrenExpanded ? "收起" : "展开"}${task.title}的子任务`}
          aria-expanded={childrenExpanded}
          title={childrenExpanded ? "收起子任务" : "展开子任务"}
          draggable={false}
          onPointerDown={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onToggleChildren(task.id);
          }}
        >
          <span aria-hidden="true">{childrenExpanded ? "▾" : "▸"}</span>
        </button>
      )}
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
      <label
        className="inline-date"
        onPointerDown={(event) => {
          const input = event.currentTarget.querySelector("input");
          if (input?.showPicker) event.preventDefault();
        }}
        onClick={(event) => {
          const input = event.currentTarget.querySelector("input");
          if (input?.showPicker) {
            event.preventDefault();
            openDatePicker(input);
          }
        }}
      >
        <span>计划日</span>
        <input
          aria-label={`${task.title}的计划日`}
          type="date"
          value={task.plannedDate?.slice(0, 10) ?? ""}
          onChange={(event) => void onUpdate(task, { plannedDate: event.target.value || null })}
        />
      </label>
      <button
        type="button"
        className="score score-button"
        title="点击人工调整综合分"
        aria-label={`${task.title}的综合分${task.score === null ? "未生成" : ` ${task.score}`}，点击人工调整`}
        aria-expanded={scoreEditorOpen}
        aria-controls={`score-editor-${task.id}`}
        draggable={false}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (scoreEditorOpen) cancelScoreEdit();
          else openScoreEditor();
        }}
      >
        {task.score === null ? "—" : task.score}
      </button>
      {scoreEditorOpen && (
        <form
          id={`score-editor-${task.id}`}
          className="score-editor-panel"
          aria-label={`人工调整${task.title}的综合分`}
          onSubmit={(event) => void saveScore(event)}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape" && !scoreSaving) cancelScoreEdit();
          }}
        >
          <header>
            <div>
              <strong>人工调整综合分</strong>
              <small>影响力 40% · 紧迫度 35% · 方向一致性 25%</small>
            </div>
            <output aria-live="polite">
              预览 {scorePreview ? calculateCompositeScore(scorePreview) : "—"}
            </output>
          </header>
          <fieldset className="score-dimension-grid" disabled={scoreSaving}>
            <legend className="sr-only">三维评分与精力成本元数据，每项范围为 0 到 100</legend>
            {scoreDimensionFields.map(({ key, label, hint }) => (
              <label key={key} htmlFor={`task-${task.id}-score-${key}`}>
                <span>{label}</span>
                <input
                  id={`task-${task.id}-score-${key}`}
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  required
                  value={scoreDraft[key]}
                  onChange={(event) => {
                    const value = parseScoreDimensionDraftValue(
                      event.currentTarget.value,
                      event.currentTarget.valueAsNumber,
                    );
                    setScoreDraft((current) => ({ ...current, [key]: value }));
                  }}
                />
                <small>{hint}</small>
              </label>
            ))}
          </fieldset>
          <footer>
            <span className="score-editor-status" aria-live="polite">
              {scoreSaving
                ? "正在保存…"
                : pendingScore
                  ? "未确认保存，输入已保留"
                  : "精力成本不参与综合分"}
            </span>
            <div>
              <button type="button" className="button button-secondary" disabled={scoreSaving} onClick={cancelScoreEdit}>取消</button>
              <button type="submit" className="button button-primary" disabled={scoreSaving}>保存分数</button>
            </div>
          </footer>
        </form>
      )}
      {hasChildren && <span className="sr-only">包含子任务</span>}
    </article>
  );
}

export function TaskBoard(props: TaskBoardProps): ReactElement {
  const {
    view,
    tasks,
    filters,
    tags,
    onViewChange,
    onFiltersChange,
    onAdd,
    onUpdate,
    onOpen,
    onReorder,
  } = props;
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string | "end";
    position: TaskDropPosition;
  } | null>(null);
  const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(() => new Set());
  const [collapsedQueues, setCollapsedQueues] = useState<Set<TaskQueueGroupKey>>(() => new Set());
  const pointerDrag = useRef<{
    pointerId: number;
    taskId: string;
    startX: number;
    startY: number;
    active: boolean;
    target: { id: string | "end"; position: TaskDropPosition } | null;
  } | null>(null);
  const currentDate = todayKey();
  const orderedRows = useMemo(
    () => view === "tasks" ? taskRowsByRank(tasks) : taskTreeRows(tasks),
    [tasks, view],
  );
  const matchedRows = useMemo(
    () =>
      orderedRows.filter(
        ({ task }) =>
          (filters.temperature === "all" || task.temperature === filters.temperature) &&
          (filters.status === "all" || task.status === filters.status) &&
          matchesTagKeyword(task.tags, filters.tag) &&
          (view === "today" || matchesTaskTimeFilter(task, filters.time, currentDate)),
      ),
    [currentDate, filters, orderedRows, view],
  );
  const activeCollapsedTaskIds = useMemo(() => {
    const matchedIds = new Set(matchedRows.map(({ task }) => task.id));
    return new Set([...collapsedTaskIds].filter((id) => matchedIds.has(id)));
  }, [collapsedTaskIds, matchedRows]);
  const visibleRows = useMemo(() => {
    const matchedIds = new Set(matchedRows.map(({ task }) => task.id));
    return visibleTaskTreeRows(orderedRows, activeCollapsedTaskIds)
      .filter(({ task }) => matchedIds.has(task.id));
  }, [activeCollapsedTaskIds, matchedRows, orderedRows]);
  const queueSections = useMemo(
    () => queueGroups
      .map((group) => {
        const allRows = matchedRows.filter(
          ({ task }) => taskQueueGroup(task, currentDate) === group.key,
        );
        const rows = visibleRows.filter(
          ({ task }) => taskQueueGroup(task, currentDate) === group.key,
        );
        return { ...group, allRows, rows, hiddenByParent: allRows.length - rows.length };
      })
      .filter(({ allRows }) => allRows.length > 0),
    [currentDate, matchedRows, visibleRows],
  );
  const renderedRows = useMemo(
    () => view === "tasks"
      ? queueSections.flatMap((section) => collapsedQueues.has(section.key) ? [] : section.rows)
      : visibleRows,
    [collapsedQueues, queueSections, view, visibleRows],
  );
  const reorderScopeIds = useMemo(
    () => renderedRows.map(({ task }) => task.id),
    [renderedRows],
  );
  const visibleTasks = matchedRows.map(({ task }) => task);
  const filterActive =
    filters.temperature !== "all" ||
    filters.status !== "all" ||
    Boolean(filters.tag.trim()) ||
    (view === "tasks" && filters.time !== "current");
  const canReorder = !filterActive;
  const completed = tasks.filter((task) => task.status === "completed").length;
  const completion = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;

  function resolveReorderTarget(sourceId: string, rawTargetId: string): string | null {
    if (!reorderScopeIds.includes(rawTargetId) || sourceId === rawTargetId) return null;
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
    return anchorId && reorderScopeIds.includes(anchorId) ? anchorId : null;
  }

  function reorderAnchorsFor(sourceId: string): string[] {
    const anchors: string[] = [];
    const seen = new Set<string>();
    for (const candidateId of reorderScopeIds) {
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
    if (!canReorder || event.pointerType === "mouse" || !event.isPrimary) return;
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
    if (!drag.active && passedPointerDragThreshold(drag.startX, drag.startY, event.clientX, event.clientY)) {
      drag.active = true;
      setDraggingId(drag.taskId);
    }
    if (!drag.active) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(
      "[data-task-drop-id], [data-task-drop-end]",
    );
    let nextTarget: { id: string | "end"; position: TaskDropPosition } | null = null;
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

  function finishPointer(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false): void {
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
    if (!canReorder || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
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

  function renderTaskRow({ task, depth, ancestorTitles, lineageIssue, hasChildren }: (typeof visibleRows)[number]): ReactElement {
    return (
      <TaskRow
        key={task.id}
        task={task}
        depth={depth}
        ancestorTitles={ancestorTitles}
        lineageIssue={lineageIssue}
        hasChildren={hasChildren}
        childrenExpanded={!collapsedTaskIds.has(task.id)}
        canReorder={canReorder}
        dragging={draggingId === task.id}
        dropPosition={dropTarget?.id === task.id ? dropTarget.position : null}
        onUpdate={onUpdate}
        onOpen={onOpen}
        onToggleChildren={toggleTaskChildren}
        onDragStart={(event, id) => {
          setDraggingId(id);
          setDropTarget(null);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", id);
        }}
        onDragEnd={() => {
          setDraggingId(null);
          setDropTarget(null);
        }}
        onDragOver={(event, id) => {
          if (!canReorder) return;
          const sourceId = draggingId ?? event.dataTransfer.getData("text/plain");
          const anchorId = sourceId ? resolveReorderTarget(sourceId, id) : null;
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
        }}
        onDrop={drop}
        onPointerStart={startPointer}
        onPointerMove={movePointer}
        onPointerEnd={finishPointer}
        onKeyboardReorder={keyboardReorder}
      />
    );
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
            aria-label="任务范围"
            value={view}
            onChange={(event) => onViewChange(event.target.value as "tasks" | "today")}
          >
            <option value="tasks">全部任务</option>
            <option value="today">今天</option>
          </select>
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
          <input
            type="search"
            aria-label="按标签筛选"
            list="task-tag-options"
            value={filters.tag}
            placeholder="标签关键词"
            onChange={(event) => onFiltersChange({ ...filters, tag: event.target.value })}
          />
          <datalist id="task-tag-options">
            {tags.map((tag) => <option key={tag} value={tag} />)}
          </datalist>
          {view === "tasks" && (
            <select
              aria-label="按时间筛选"
              value={filters.time}
              onChange={(event) =>
                onFiltersChange({ ...filters, time: event.target.value as TaskTimeFilter })
              }
            >
              <option value="current">当前队列</option>
              <option value="target_today">目标时间 · 今天</option>
              <option value="target_future">目标时间 · 未来</option>
              <option value="target_past">目标时间 · 过去</option>
              <option value="completed_today">完成时间 · 今天</option>
              <option value="completed_past">完成时间 · 过去</option>
              <option value="all">全部时间</option>
            </select>
          )}
          {filterActive && (
            <button
              className="text-button"
              type="button"
              onClick={() => onFiltersChange({ temperature: "all", status: "all", tag: "", time: "current" })}
            >
              清除筛选
            </button>
          )}
        </div>
        <span className="result-count" aria-live="polite">{visibleTasks.length} 项</span>
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
          <div
            className={`task-tree ${view === "tasks" ? "is-grouped" : ""}`}
            role={view === "today" ? "tree" : undefined}
            aria-label={view === "today" ? "任务层级列表" : undefined}
          >
            {view === "tasks"
              ? queueSections.map((section) => {
                  const collapsed = collapsedQueues.has(section.key);
                  const toggleId = `task-queue-toggle-${section.key}`;
                  const contentId = `task-queue-content-${section.key}`;
                  return (
                    <section className={`task-queue-section queue-${section.key}`} key={section.key}>
                      <header>
                        <button
                          id={toggleId}
                          type="button"
                          className="task-queue-toggle"
                          aria-expanded={!collapsed}
                          aria-controls={contentId}
                          onClick={() => toggleQueue(section.key)}
                        >
                          <strong>{section.label}</strong>
                          <span className="task-queue-count">{section.allRows.length}</span>
                          <span className="task-queue-chevron" aria-hidden="true">
                            {collapsed ? "▸" : "▾"}
                          </span>
                        </button>
                      </header>
                      <div id={contentId} role="tree" aria-labelledby={toggleId} hidden={collapsed}>
                        {section.rows.map(renderTaskRow)}
                      </div>
                      {!collapsed && section.hiddenByParent > 0 && (
                        <p className="task-queue-hidden-note">
                          {section.hiddenByParent} 项随父任务收起
                        </p>
                      )}
                    </section>
                  );
                })
              : visibleRows.map(renderTaskRow)}
            {canReorder && tasks.length > 1 && (
              <div
                className={`task-drop-end ${dropTarget?.id === "end" ? "is-active" : ""}`}
                data-task-drop-end
                role="button"
                aria-label="将正在拖动的任务移到列表末尾"
                aria-disabled={!draggingId}
                tabIndex={-1}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTarget({ id: "end", position: "after" });
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
                }}
                onDrop={dropAtEnd}
              >
                <span aria-hidden="true">↓</span>
                拖到这里移至当前同级队列末尾
              </div>
            )}
          </div>
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
              onClick={() => onFiltersChange({ temperature: "all", status: "all", tag: "", time: "current" })}
            >
              清除筛选
            </button>
          )}
        </div>
      )}
    </section>
  );
}
