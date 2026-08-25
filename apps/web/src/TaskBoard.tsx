import { useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactElement,
} from "react";
import type {
  TaskGroup,
  TaskScoreDimensions,
  TaskStatus,
  Temperature,
} from "./types";
import { taskTargetDate } from "./v02-utils";
import type { TaskTimeFilter } from "./v02-utils";
import {
  calculateCompositeScore,
  formatLongDate,
  formatShortDate,
  mergeTags,
  openDatePicker,
  shouldCommitTagKey,
  statusLabels,
  statusTransitions,
  temperatureLabels,
} from "./utils";
import type {
  TaskBoardProps,
  TaskFilters,
  TaskRowRendererProps,
} from "./features/tasks/contracts";
import {
  buildQuickTaskInput,
  buildTaskGroupUpdatePatch,
  claimParentInheritance,
  createScoreDimensionDraft,
  createScoreEditorState,
  defaultScoreDimensions,
  matchesTaskGroupFilter,
  normalizeScoreDimensionDraft,
  normalizeTaskGroupColor,
  parseScoreDimensionDraftValue,
  sameScoreDimensions,
  scoreDimensionFields,
  taskCompletionMotionDuration,
  taskCompletionMotionDurations,
  taskGroupColorPresets,
} from "./features/tasks/model";
import type { ScoreDimensionDraft } from "./features/tasks/model";
import {
  taskGroupEditorColor,
  useTaskBoardController,
} from "./features/tasks/useTaskBoardController";

export type {
  TaskBoardProps,
  TaskBoardRenderers,
  TaskCompletionMotion,
  TaskFilters,
  TaskRowRendererProps,
} from "./features/tasks/contracts";
export type { QuickAddDraft, ScoreDimensionDraft } from "./features/tasks/model";
export {
  buildQuickTaskInput,
  buildTaskGroupUpdatePatch,
  claimParentInheritance,
  createScoreDimensionDraft,
  createScoreEditorState,
  matchesTaskGroupFilter,
  normalizeScoreDimensionDraft,
  normalizeTaskGroupColor,
  parseScoreDimensionDraftValue,
  taskCompletionMotionDuration,
  taskCompletionMotionDurations,
  taskGroupColorPresets,
};

export function TaskGroupCreator({
  idPrefix,
  variant,
  onCreate,
  onCreated,
  onCancel,
}: {
  idPrefix: string;
  variant: "quick" | "detail";
  onCreate: TaskBoardProps["onCreateTaskGroup"];
  onCreated: (group: TaskGroup) => void;
  onCancel: () => void;
}): ReactElement {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(taskGroupColorPresets[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const normalizedColor = normalizeTaskGroupColor(color);

  async function create(): Promise<void> {
    const normalizedName = name.trim();
    if (!normalizedName || !normalizedColor) {
      setError("请输入分组名称并选择有效颜色");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const created = await onCreate({ name: normalizedName, color: normalizedColor });
      onCreated(created);
      setName("");
      setColor(taskGroupColorPresets[0]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建失败，输入已保留");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      id={`${idPrefix}-creator`}
      className={`${variant}-group-creator`}
      aria-label="新建任务分组"
    >
      <label htmlFor={`${idPrefix}-name`}>
        <span>分组名称</span>
        <input
          id={`${idPrefix}-name`}
          value={name}
          maxLength={100}
          placeholder="例如：产品迭代"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void create();
          }}
        />
      </label>
      <fieldset>
        <legend>分组颜色</legend>
        <div className={`${variant}-group-colors`}>
          {taskGroupColorPresets.map((preset) => (
            <button
              type="button"
              key={preset}
              className={`${variant}-group-color-option`}
              style={{ "--task-group-option-color": preset } as CSSProperties}
              aria-label={`选择颜色 ${preset}`}
              aria-pressed={color === preset}
              onClick={() => setColor(preset)}
            />
          ))}
          <label className={`${variant}-group-custom-color`}>
            <span>自定义色</span>
            <input
              type="color"
              aria-label="自定义分组颜色"
              value={normalizedColor ?? taskGroupColorPresets[0]}
              onChange={(event) => setColor(event.target.value.toUpperCase())}
            />
          </label>
        </div>
      </fieldset>
      {error && <p className={`${variant}-group-error`} role="alert">{error}</p>}
      <div className={`${variant}-group-actions`}>
        <button type="button" className="button button-secondary" disabled={saving} onClick={onCancel}>取消</button>
        <button type="button" className="button button-primary" disabled={saving || !name.trim() || !normalizedColor} onClick={() => void create()}>
          {saving ? "创建中…" : "创建分组"}
        </button>
      </div>
    </section>
  );
}

function QuickAdd({
  view,
  onAdd,
  taskGroups,
  onCreateTaskGroup,
}: Pick<TaskBoardProps, "view" | "onAdd" | "taskGroups" | "onCreateTaskGroup">): ReactElement {
  const [title, setTitle] = useState("");
  const [temperature, setTemperature] = useState<Temperature>(
    view === "today" ? "hot" : "warm",
  );
  const [deadline, setDeadline] = useState("");
  const [groupId, setGroupId] = useState("");
  const [groupCreatorOpen, setGroupCreatorOpen] = useState(false);
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
        groupId,
        tags,
        tagInput,
        manualScore,
        scoreDimensions: normalizedScore ?? defaultScoreDimensions,
      }));
      setTitle("");
      setDescription("");
      setDeadline("");
      setGroupId("");
      setGroupCreatorOpen(false);
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
    <form
      className={`quick-add quick-group-layout ${groupCreatorOpen ? "quick-group-creating" : ""} ${advancedOpen ? "has-advanced" : ""} ${invalid ? "is-invalid" : ""}`}
      onSubmit={submit}
    >
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
      <div className="quick-group-picker">
        <select
          aria-label="新任务分组"
          value={groupId}
          onChange={(event) => setGroupId(event.target.value)}
        >
          <option value="">未分组</option>
          {taskGroups.map((group) => (
            <option value={group.id} key={group.id}>{group.name}</option>
          ))}
        </select>
        <button
          type="button"
          aria-expanded={groupCreatorOpen}
          aria-controls="quick-task-group-creator"
          onClick={() => setGroupCreatorOpen((current) => !current)}
        >新建分组</button>
      </div>
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
      {groupCreatorOpen && (
        <TaskGroupCreator
          idPrefix="quick-task-group"
          variant="quick"
          onCreate={onCreateTaskGroup}
          onCreated={(group) => {
            setGroupId(group.id);
            setGroupCreatorOpen(false);
          }}
          onCancel={() => setGroupCreatorOpen(false)}
        />
      )}
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

export function DefaultTaskRow({
  task,
  parentTask,
  group,
  depth,
  ancestorTitles,
  lineageIssue,
  hasChildren,
  childrenExpanded,
  canReorder,
  dragging,
  dropPosition,
  completionMotion,
  onUpdate,
  onInheritParent,
  onOpen,
  onSelectGroup,
  onToggleChildren,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onPointerStart,
  onPointerMove,
  onPointerEnd,
  onKeyboardReorder,
}: TaskRowRendererProps): ReactElement {
  const done = task.status === "completed" || task.status === "archived";
  const transitioning = completionMotion !== null;
  const visualDone = done || completionMotion === "exiting" || completionMotion === "entering";
  const displayedStatus = completionMotion === "exiting" ? "completed" : task.status;
  const [scoreEditorOpen, setScoreEditorOpen] = useState(false);
  const initialScoreEditorState = createScoreEditorState(
    task.scoreDimensions,
    parentTask?.scoreDimensions,
  );
  const [scoreDraft, setScoreDraft] = useState<ScoreDimensionDraft>(initialScoreEditorState.draft);
  const [inheritsParentScore, setInheritsParentScore] = useState(
    initialScoreEditorState.inheritsParent,
  );
  const [scoreSaving, setScoreSaving] = useState(false);
  const [inheritancePending, setInheritancePending] = useState(false);
  const inheritancePendingRef = useRef(false);
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

  useEffect(() => {
    if (!scoreEditorOpen || !inheritsParentScore) return;
    if (parentTask?.scoreDimensions) {
      setScoreDraft(createScoreDimensionDraft(parentTask.scoreDimensions));
    } else {
      setInheritsParentScore(false);
    }
  }, [inheritsParentScore, parentTask?.scoreDimensions, scoreEditorOpen]);

  function openScoreEditor(): void {
    const initial = createScoreEditorState(task.scoreDimensions, parentTask?.scoreDimensions);
    setScoreDraft(initial.draft);
    setInheritsParentScore(initial.inheritsParent);
    setPendingScore(null);
    setScoreEditorOpen(true);
  }

  function cancelScoreEdit(): void {
    const initial = createScoreEditorState(task.scoreDimensions, parentTask?.scoreDimensions);
    setScoreDraft(initial.draft);
    setInheritsParentScore(initial.inheritsParent);
    setPendingScore(null);
    setScoreEditorOpen(false);
  }

  async function saveScore(event: FormEvent): Promise<void> {
    event.preventDefault();
    const requested = inheritsParentScore && parentTask?.scoreDimensions
      ? parentTask.scoreDimensions
      : normalizeScoreDimensionDraft(scoreDraft);
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

  async function inheritParent(event: ReactMouseEvent<HTMLButtonElement>): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    if (!claimParentInheritance(task.parentTaskId, inheritancePendingRef)) return;
    setInheritancePending(true);
    try {
      await onInheritParent(task);
    } finally {
      inheritancePendingRef.current = false;
      setInheritancePending(false);
    }
  }

  const scorePreview = normalizeScoreDimensionDraft(scoreDraft);

  return (
    <article
      className={`task-row task-depth-${depth} ${group ? "task-group-row" : ""} ${hasChildren ? "has-children" : ""} ${task.parentTaskId ? "has-parent" : ""} ${visualDone ? "is-complete" : ""} ${completionMotion ? `is-completion-${completionMotion}` : ""} ${dragging ? "is-dragging" : ""} ${dropPosition ? `is-drop-${dropPosition}` : ""} ${scoreEditorOpen ? "score-editor-open" : ""}`}
      style={group ? ({ "--task-group-color": group.color } as CSSProperties) : undefined}
      data-slot="task-row"
      data-status={task.status}
      data-temperature={task.temperature}
      data-depth={depth}
      data-grouped={group ? "true" : "false"}
      data-state={completionMotion ?? (visualDone ? "complete" : "active")}
      data-task-drop-id={task.id}
      data-task-target-date={targetDate ?? undefined}
      role="treeitem"
      aria-level={depth}
      aria-label={`${task.title}${ancestorPath ? `，隶属 ${ancestorPath}` : ""}${lineageWarning ? `，${lineageWarning}` : ""}${targetDate ? `，目标日期 ${targetDate}` : ""}`}
      aria-busy={transitioning || undefined}
      draggable={canReorder && !scoreEditorOpen && !transitioning}
      onDragStart={(event) => onDragStart(event, task.id)}
      onDragEnd={onDragEnd}
      onDragOver={(event) => onDragOver(event, task.id)}
      onDrop={(event) => onDrop(event, task.id)}
    >
      <button
        type="button"
        className="drag-handle"
        disabled={transitioning}
        aria-disabled={!canReorder}
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
        className={`complete-toggle ${visualDone ? "checked" : ""}`}
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
        disabled={!actionStatus || transitioning || scoreEditorOpen}
        onClick={() => actionStatus && void onUpdate(task, { status: actionStatus })}
      >
        {task.status === "todo" || visualDone ? "" : "·"}
      </button>
      <div className="task-summary">
        <button
          type="button"
          className="task-summary-open"
          aria-label={`打开任务详情：${task.title}`}
          disabled={transitioning}
          onClick={() => onOpen(task)}
        />
        <span className="task-title-line">
          <strong>{task.title}</strong>
          {task.hardness === "hard" && <span className="hard-mark" title="硬任务">◆</span>}
          {group && (
            <button
              type="button"
              className="task-group-marker"
              aria-label={`按分组筛选：${group.name}`}
              title={`只看「${group.name}」分组`}
              disabled={transitioning}
              draggable={false}
              onPointerDown={(event) => event.stopPropagation()}
              onDragStart={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                onSelectGroup(group.id);
              }}
            >
              <span aria-hidden="true" />
              <b>{group.name}</b>
            </button>
          )}
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
      </div>
      {(hasChildren || task.parentTaskId) && (
        <div className="task-lineage-actions">
          {hasChildren && (
            <button
              type="button"
              className="task-children-toggle"
              disabled={transitioning || inheritancePending}
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
          {task.parentTaskId && (
            <button
              type="button"
              className="task-inherit-parent"
              disabled={transitioning || inheritancePending}
              aria-label={`从父任务继承${task.title}的分组、标签与评分`}
              title={parentTask
                ? `继承「${parentTask.title}」的分组、标签与评分`
                : "同步父任务当前的分组、标签与评分"}
              draggable={false}
              onPointerDown={(event) => event.stopPropagation()}
              onDragStart={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => void inheritParent(event)}
            >
              <span aria-hidden="true">↥</span>
              {inheritancePending ? "继承中" : "继承"}
            </button>
          )}
        </div>
      )}
      <select
        aria-label={`${task.title}的温度`}
        className={`inline-select temperature-${task.temperature}`}
        value={task.temperature}
        disabled={transitioning}
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
        value={displayedStatus}
        disabled={transitioning}
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
          disabled={transitioning}
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
        disabled={transitioning}
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
          {task.parentTaskId && (
            <div className="score-inheritance-row">
              <label className="score-inheritance-toggle">
                <input
                  type="checkbox"
                  checked={inheritsParentScore}
                  disabled={scoreSaving || !parentTask?.scoreDimensions}
                  onChange={(event) => {
                    const inherits = event.currentTarget.checked;
                    setInheritsParentScore(inherits);
                    if (inherits && parentTask?.scoreDimensions) {
                      setScoreDraft(createScoreDimensionDraft(parentTask.scoreDimensions));
                    }
                  }}
                />
                继承父任务数值
              </label>
              <small>
                {parentTask?.scoreDimensions
                  ? inheritsParentScore
                    ? `当前继承「${parentTask.title}」，取消勾选后可自定义`
                    : `可重新采用「${parentTask.title}」的评分`
                  : "父任务尚无维度评分，暂不可继承"}
              </small>
            </div>
          )}
          <fieldset className="score-dimension-grid" disabled={scoreSaving || inheritsParentScore}>
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
                  : inheritsParentScore
                    ? "保存后采用父任务当前的维度分"
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
    allTasks,
    taskGroups,
    filters,
    tags,
    onViewChange,
    onFiltersChange,
    onAdd,
    onCreateTaskGroup,
    onUpdate,
    onInheritParent,
    onOpen,
    rollForwardTargetDate,
    completionMotions = {},
  } = props;
  const { viewModel, actions } = useTaskBoardController(props);
  const {
    visibleRows,
    queueSections,
    visibleTasks,
    filterActive,
    canReorder,
    completed,
    completion,
    completionAnnouncement,
    taskGroupsById,
    selectedFilterGroup,
    groupEditor,
    collapsedTaskIds,
    collapsedQueues,
    draggingId,
    dropTarget,
    rollingOverdue,
  } = viewModel;
  const TaskRowRenderer = props.renderers?.TaskRow ?? DefaultTaskRow;
  function renderTaskRow({ task, depth, ancestorTitles, lineageIssue, hasChildren }: (typeof visibleRows)[number]): ReactElement {
    return (
      <TaskRowRenderer
        key={task.id}
        task={task}
        parentTask={task.parentTaskId
          ? allTasks.find((candidate) => candidate.id === task.parentTaskId) ?? null
          : null}
        group={task.groupId ? taskGroupsById.get(task.groupId) ?? null : null}
        depth={depth}
        ancestorTitles={ancestorTitles}
        lineageIssue={lineageIssue}
        hasChildren={hasChildren}
        childrenExpanded={!collapsedTaskIds.has(task.id)}
        canReorder={canReorder && !completionMotions[task.id]}
        dragging={draggingId === task.id}
        dropPosition={dropTarget?.id === task.id ? dropTarget.position : null}
        completionMotion={completionMotions[task.id] ?? null}
        onUpdate={onUpdate}
        onInheritParent={onInheritParent}
        onOpen={onOpen}
        onSelectGroup={actions.selectGroup}
        onToggleChildren={actions.toggleTaskChildren}
        onDragStart={actions.nativeDragStart}
        onDragEnd={actions.nativeDragEnd}
        onDragOver={actions.nativeDragOver}
        onDrop={actions.drop}
        onPointerStart={actions.startPointer}
        onPointerMove={actions.movePointer}
        onPointerEnd={actions.finishPointer}
        onKeyboardReorder={actions.keyboardReorder}
      />
    );
  }

  return (
    <section className="board" data-slot="task-board" data-view={view}>
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

      <QuickAdd
        view={view}
        taskGroups={taskGroups}
        onAdd={onAdd}
        onCreateTaskGroup={onCreateTaskGroup}
      />

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
          {selectedFilterGroup && (
            <div className="task-group-color-editor">
              <input
                type="text"
                className="task-group-name-input"
                aria-label={`修改「${selectedFilterGroup.name}」的名称`}
                aria-invalid={!groupEditor.name.trim()}
                value={groupEditor.name}
                onChange={(event) => {
                  actions.setGroupName(event.target.value);
                  actions.clearGroupError();
                }}
              />
              <input
                type="color"
                aria-label={`修改「${selectedFilterGroup.name}」的颜色`}
                value={taskGroupEditorColor(groupEditor, selectedFilterGroup)}
                onChange={(event) => {
                  actions.setGroupColor(event.target.value.toUpperCase());
                  actions.clearGroupError();
                }}
              />
              <button
                type="button"
                className="text-button"
                disabled={groupEditor.saving || !groupEditor.dirty || Boolean(groupEditor.validationError)}
                onClick={() => void actions.saveSelectedGroup()}
              >{groupEditor.saving ? "保存中…" : "保存分组"}</button>
              {(groupEditor.error || groupEditor.validationError) && (
                <span role="alert">{groupEditor.error || groupEditor.validationError}</span>
              )}
            </div>
          )}
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
              onClick={actions.clearFilters}
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
                      <header className={section.key === "overdue" ? "has-roll-forward" : undefined}>
                        <button
                          id={toggleId}
                          type="button"
                          className="task-queue-toggle"
                          aria-expanded={!collapsed}
                          aria-controls={contentId}
                          onClick={() => actions.toggleQueue(section.key)}
                        >
                          <strong>{section.label}</strong>
                          <span className="task-queue-count">{section.allRows.length}</span>
                          <span className="task-queue-chevron" aria-hidden="true">
                            {collapsed ? "▸" : "▾"}
                          </span>
                        </button>
                        {section.key === "overdue" && (
                          <button
                            type="button"
                            className="task-queue-roll-forward"
                            disabled={rollingOverdue}
                            onClick={() => void actions.rollForwardOverdue()}
                            aria-label={`将${section.allRows.length}项逾期任务一键顺延至${formatShortDate(rollForwardTargetDate)}`}
                          >
                            {rollingOverdue ? "顺延中…" : "一键顺延"}
                          </button>
                        )}
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
                onDragOver={actions.dragOverEnd}
                onDragLeave={actions.dragLeaveEnd}
                onDrop={actions.dropAtEnd}
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
              onClick={actions.clearFilters}
            >
              清除筛选
            </button>
          )}
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {completionAnnouncement}
      </span>
    </section>
  );
}
