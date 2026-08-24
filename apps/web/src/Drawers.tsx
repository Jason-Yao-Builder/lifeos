import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
  ReactNode,
} from "react";
import type { LifeOSApi } from "./api";
import { CoachIcon } from "./Icons";
import type {
  AiCard,
  Goal,
  RepeatTemplate,
  Rule,
  Task,
  TaskDependency,
  TaskEvent,
  TaskImage,
  TaskProgress,
  TaskStatus,
  Temperature,
  UpdateTask,
} from "./types";
import {
  cardTypeLabels,
  mergeTags,
  openDatePicker,
  readableValue,
  relativeTime,
  statusLabels,
  statusTransitions,
  temperatureLabels,
} from "./utils";
import { hierarchyDepth, reorderTaskIds, taskDropPosition, taskTreeRows } from "./v02-utils";
import type { TaskDropPosition } from "./v02-utils";

interface DrawerShellProps {
  open: boolean;
  title: string;
  eyebrow?: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}

function DrawerShell({
  open,
  title,
  eyebrow,
  wide,
  onClose,
  children,
}: DrawerShellProps): ReactElement | null {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="drawer-layer" role="presentation">
      <button className="drawer-backdrop" aria-label="关闭抽屉" onClick={onClose} />
      <aside className={`drawer ${wide ? "drawer-wide" : ""}`} aria-label={title}>
        <header className="drawer-header">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        {children}
      </aside>
    </div>
  );
}

interface TaskDrawerProps {
  task: Task | null;
  api: LifeOSApi;
  onClose: () => void;
  onSave: (task: Task, patch: UpdateTask) => Promise<void>;
  onOpenTask: (taskId: string) => void;
  allTasks: Task[];
  goals: Goal[];
  onStructureChanged: () => Promise<void>;
}

function taskDraft(task: Task | null): UpdateTask {
  return task
    ? {
        title: task.title,
        description: task.description,
        temperature: task.temperature,
        status: task.status,
        deadline: task.deadline?.slice(0, 10) ?? null,
        plannedDate: task.plannedDate?.slice(0, 10) ?? null,
        goalId: task.goalId ?? null,
        tags: task.tags,
      }
    : {};
}

const TASK_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const TASK_IMAGE_ACCEPT = Array.from(TASK_IMAGE_TYPES).join(",");
const TASK_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const TASK_IMAGE_MAX_COUNT = 20;

interface TaskImageFileCandidate {
  name: string;
  type: string;
  size: number;
}

export function taskImageValidationError(
  files: readonly TaskImageFileCandidate[],
  existingCount: number,
): string | null {
  if (existingCount + files.length > TASK_IMAGE_MAX_COUNT) {
    return `每个任务最多保存 ${TASK_IMAGE_MAX_COUNT} 张图片，当前还可添加 ${Math.max(0, TASK_IMAGE_MAX_COUNT - existingCount)} 张。`;
  }
  for (const file of files) {
    if (!TASK_IMAGE_TYPES.has(file.type.toLowerCase())) {
      return `「${file.name || "未命名图片"}」格式不支持，请使用 PNG、JPEG、WebP 或 GIF。`;
    }
    if (file.size > TASK_IMAGE_MAX_BYTES) {
      return `「${file.name || "未命名图片"}」超过 5MB，请压缩后重试。`;
    }
  }
  return null;
}

export async function taskImageFileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)));
  }
  return btoa(chunks.join(""));
}

export function taskImageSizeLabel(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pastedTaskImageName(mimeType: string, index: number): string {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1] ?? "png";
  return `粘贴图片-${Date.now()}-${index + 1}.${extension}`;
}

export interface DependencyCandidateOption {
  task: Task;
  ancestorPath: string;
  statusLabel: string;
  shortId: string;
  label: string;
}

export type SubtaskReorderKey = "ArrowUp" | "ArrowDown" | "Home" | "End";

export function knownDirectSubtasks(parentId: string, tasks: readonly Task[]): Task[] {
  return tasks
    .filter((task) => task.parentTaskId === parentId)
    .sort((left, right) => left.rank - right.rank);
}

export function subtasksAfterLoad(
  current: readonly Task[],
  result: PromiseSettledResult<Task[]>,
): Task[] {
  return result.status === "fulfilled" ? result.value : [...current];
}

export function reorderSubtaskIds(
  orderedIds: readonly string[],
  sourceId: string,
  targetId: string,
  position: TaskDropPosition,
): string[] {
  return reorderTaskIds(orderedIds, sourceId, targetId, position);
}

export function reorderSubtaskIdsByKey(
  orderedIds: readonly string[],
  sourceId: string,
  key: SubtaskReorderKey,
): string[] {
  const sourceIndex = orderedIds.indexOf(sourceId);
  if (sourceIndex < 0) return [...orderedIds];
  const movingUp = key === "ArrowUp" || key === "Home";
  const targetId = key === "Home"
    ? orderedIds[0]
    : key === "End"
      ? orderedIds.at(-1)
      : movingUp
        ? orderedIds[sourceIndex - 1]
        : orderedIds[sourceIndex + 1];
  if (!targetId || targetId === sourceId) return [...orderedIds];
  return reorderSubtaskIds(orderedIds, sourceId, targetId, movingUp ? "before" : "after");
}

function compactTaskId(taskId: string): string {
  return taskId.length <= 12 ? taskId : `${taskId.slice(0, 6)}…${taskId.slice(-4)}`;
}

function dependencyCandidateOption(
  task: Task,
  tasks: Task[],
  knownAncestorTitles?: string[],
): DependencyCandidateOption {
  const ancestorTitles = knownAncestorTitles
    ?? taskTreeRows(tasks).find((candidate) => candidate.task.id === task.id)?.ancestorTitles
    ?? [];
  const ancestorPath = ancestorTitles.join(" › ");
  const shortId = compactTaskId(task.id);
  const context = ancestorPath ? `隶属 ${ancestorPath}` : "顶层任务";
  const statusLabel = statusLabels[task.status];
  return {
    task,
    ancestorPath,
    statusLabel,
    shortId,
    label: `${task.title}，${context}，${statusLabel}，编号 ${task.id}`,
  };
}

export function dependencyCandidateOptions(
  currentTaskId: string,
  tasks: Task[],
  dependencies: TaskDependency[],
  query = "",
): DependencyCandidateOption[] {
  const linkedIds = new Set(
    dependencies
      .filter((dependency) => dependency.successorId === currentTaskId)
      .map((dependency) => dependency.predecessorId),
  );
  const ancestorsById = new Map(
    taskTreeRows(tasks).map((row) => [row.task.id, row.ancestorTitles]),
  );
  const normalized = query.trim().toLocaleLowerCase();
  return tasks
    .filter((task) => task.id !== currentTaskId && task.status !== "archived" && !linkedIds.has(task.id))
    .map((task) => dependencyCandidateOption(task, tasks, ancestorsById.get(task.id) ?? []))
    .filter((option) => !normalized || option.label.toLocaleLowerCase().includes(normalized));
}

const cronFields: Array<{ name: string; min: number; max: number }> = [
  { name: "分", min: 0, max: 59 },
  { name: "时", min: 0, max: 23 },
  { name: "日", min: 1, max: 31 },
  { name: "月", min: 1, max: 12 },
  { name: "周", min: 0, max: 7 },
];

function isValidCronField(field: string, min: number, max: number): boolean {
  return field.split(",").every((part) => {
    const segments = part.split("/");
    if (segments.length > 2 || !segments[0]) return false;
    if (segments[1] !== undefined && (!/^\d+$/.test(segments[1]) || Number(segments[1]) < 1)) return false;
    if (segments[0] === "*") return true;
    const bounds = segments[0].split("-");
    if (bounds.length > 2 || bounds.some((bound) => !/^\d+$/.test(bound))) return false;
    const start = Number(bounds[0]);
    const end = Number(bounds[1] ?? bounds[0]);
    return start >= min && end <= max && start <= end;
  });
}

export function cronExpressionError(value: string): string | null {
  const expression = value.trim();
  if (expression.length < 9 || expression.length > 200) return "Cron 表达式需为 9–200 个字符。";
  const fields = expression.split(/\s+/);
  if (fields.length !== 5) return "请按「分 时 日 月 周」填写正好 5 段。";
  for (const [index, field] of fields.entries()) {
    const config = cronFields[index]!;
    if (!field || !isValidCronField(field, config.min, config.max)) {
      return `${config.name}字段无效：允许 ${config.min}–${config.max}，并支持 *、逗号、范围和步长。`;
    }
  }
  return null;
}

const cronExamples = [
  { label: "每天 9:00", value: "0 9 * * *" },
  { label: "工作日 9:00", value: "0 9 * * 1-5" },
  { label: "每周一 9:00", value: "0 9 * * 1" },
  { label: "每月 1 日 9:00", value: "0 9 1 * *" },
] as const;

function DescriptionImagesEditor({
  task,
  api,
  value,
  onChange,
}: {
  task: Task;
  api: LifeOSApi;
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  const [images, setImages] = useState<TaskImage[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [operationError, setOperationError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadInProgress = useRef(false);

  useEffect(() => {
    let active = true;
    setImages([]);
    setLoadState("loading");
    setOperationError("");
    setUploading(false);
    setDeletingId(null);
    setDragActive(false);
    void api.getTaskImages(task.id).then((items) => {
      if (!active) return;
      setImages(items);
      setLoadState("ready");
    }).catch((reason: unknown) => {
      if (!active) return;
      setLoadState("error");
      setOperationError(reason instanceof Error
        ? `图片读取失败：${reason.message}`
        : "图片读取失败，请重试。");
    });
    return () => {
      active = false;
    };
  }, [api, reloadKey, task.id]);

  async function uploadFiles(selectedFiles: readonly File[]): Promise<void> {
    if (selectedFiles.length === 0) return;
    if (loadState !== "ready") {
      setOperationError("请等待已有图片加载完成后再上传。");
      return;
    }
    if (uploadInProgress.current) {
      setOperationError("图片正在上传，请勿重复添加。");
      return;
    }
    const fingerprints = new Set<string>();
    const files = selectedFiles.filter((file) => {
      const fingerprint = `${file.name}\u0000${file.type}\u0000${file.size}\u0000${file.lastModified}`;
      if (fingerprints.has(fingerprint)) return false;
      fingerprints.add(fingerprint);
      return true;
    });
    const validationError = taskImageValidationError(files, images.length);
    if (validationError) {
      setOperationError(validationError);
      return;
    }
    uploadInProgress.current = true;
    setUploading(true);
    setOperationError("");
    const failures: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        try {
          const dataBase64 = await taskImageFileToBase64(file);
          const image = await api.uploadTaskImage(task.id, {
            fileName: file.name || pastedTaskImageName(file.type, index),
            mimeType: file.type.toLowerCase(),
            dataBase64,
          });
          setImages((current) => current.some((item) => item.id === image.id)
            ? current
            : [...current, image]);
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : "未知错误";
          failures.push(`「${file.name || "未命名图片"}」上传失败：${message}`);
        }
      }
    } finally {
      uploadInProgress.current = false;
      setUploading(false);
      if (failures.length > 0) setOperationError(failures.join("；"));
    }
  }

  function pastedImages(event: ReactClipboardEvent<HTMLTextAreaElement>): void {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (files.length === 0) return;
    event.preventDefault();
    void uploadFiles(files);
  }

  function droppedImages(event: ReactDragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragActive(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
  }

  async function deleteImage(image: TaskImage): Promise<void> {
    if (deletingId || !window.confirm(`确认删除图片「${image.fileName}」？`)) return;
    setDeletingId(image.id);
    setOperationError("");
    try {
      await api.deleteTaskImage(task.id, image.id);
      setImages((current) => current.filter((item) => item.id !== image.id));
    } catch (reason) {
      setOperationError(reason instanceof Error
        ? `「${image.fileName}」删除失败：${reason.message}`
        : `「${image.fileName}」删除失败，请重试。`);
    } finally {
      setDeletingId(null);
    }
  }

  const unavailable = loadState !== "ready" || uploading;
  return (
    <>
      <div className="field field-full">
        <label htmlFor={`task-description-${task.id}`}>描述</label>
        <textarea
          id={`task-description-${task.id}`}
          rows={5}
          value={value}
          placeholder="补充背景、完成标准或下一步…"
          onChange={(event) => onChange(event.target.value)}
          onPaste={pastedImages}
        />
      </div>
      <section className="description-images" aria-label="描述图片附件">
        <div className="description-images-header">
          <div>
            <strong>图片附件</strong>
            <span>{images.length}/{TASK_IMAGE_MAX_COUNT}</span>
          </div>
          <button
            type="button"
            className="description-images-add"
            disabled={unavailable || images.length >= TASK_IMAGE_MAX_COUNT}
            onClick={() => fileInput.current?.click()}
          >{uploading ? "上传中…" : "+ 选择图片"}</button>
          <input
            ref={fileInput}
            className="description-images-input"
            type="file"
            accept={TASK_IMAGE_ACCEPT}
            multiple
            aria-label="选择描述图片"
            disabled={unavailable || images.length >= TASK_IMAGE_MAX_COUNT}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void uploadFiles(files);
            }}
          />
        </div>
        <div
          className={`description-images-dropzone${dragActive ? " description-images-dropzone-active" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            if (!unavailable) setDragActive(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            const nextTarget = event.relatedTarget;
            if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
              setDragActive(false);
            }
          }}
          onDrop={droppedImages}
        >
          <span aria-hidden="true">⇧</span>
          <p>拖入图片，或在上方描述框内粘贴</p>
          <small>支持 PNG、JPEG、WebP、GIF · 单图≤5MB</small>
        </div>
        {loadState === "loading" && <p className="description-images-status">正在读取图片…</p>}
        {loadState === "error" && (
          <button
            type="button"
            className="description-images-retry"
            onClick={() => setReloadKey((current) => current + 1)}
          >重试读取</button>
        )}
        {images.length > 0 && (
          <div className="description-images-grid">
            {images.map((image) => {
              const contentUrl = api.getTaskImageContentUrl(task.id, image.id);
              return <article className="description-images-item" key={image.id}>
                <a
                  className="description-images-preview"
                  href={contentUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`打开原图 ${image.fileName}`}
                ><img src={contentUrl} alt={image.fileName} /></a>
                <div className="description-images-meta">
                  <strong title={image.fileName}>{image.fileName}</strong>
                  <small>{taskImageSizeLabel(image.sizeBytes)}</small>
                </div>
                <button
                  type="button"
                  className="description-images-delete"
                  aria-label={`删除图片 ${image.fileName}`}
                  disabled={Boolean(deletingId)}
                  onClick={() => void deleteImage(image)}
                >{deletingId === image.id ? "…" : "×"}</button>
              </article>;
            })}
          </div>
        )}
        {operationError && <p className="description-images-error" role="alert">{operationError}</p>}
      </section>
    </>
  );
}

export function TaskDrawer({ task, api, onClose, onSave, onOpenTask, allTasks, goals, onStructureChanged }: TaskDrawerProps): ReactElement | null {
  const [tab, setTab] = useState<"details" | "structure" | "history">("details");
  const [draft, setDraft] = useState<UpdateTask>(() => taskDraft(task));
  const [history, setHistory] = useState<TaskEvent[]>([]);
  const [historyState, setHistoryState] = useState<"idle" | "loading" | "error">("idle");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tagInput, setTagInput] = useState("");
  const previousTaskId = useRef<string | null>(null);

  useEffect(() => {
    setDraft(taskDraft(task));
    if (!task || previousTaskId.current === null) setTab("details");
    setError("");
    setTagInput("");
    previousTaskId.current = task?.id ?? null;
  }, [task]);

  function commitTags(): void {
    if (!tagInput.trim()) return;
    setDraft((current) => ({
      ...current,
      tags: mergeTags(current.tags ?? [], tagInput),
    }));
    setTagInput("");
  }

  function handleTagKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing) return;
    if (["Enter", ",", "，"].includes(event.key)) {
      event.preventDefault();
      commitTags();
    }
  }

  useEffect(() => {
    if (!task || tab !== "history") return;
    let active = true;
    setHistoryState("loading");
    void api
      .getTaskEvents(task.id)
      .then((events) => {
        if (!active) return;
        setHistory(events);
        setHistoryState("idle");
      })
      .catch(() => {
        if (active) setHistoryState("error");
      });
    return () => {
      active = false;
    };
  }, [api, tab, task]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!task) return;
    if (!draft.title?.trim()) {
      setError("任务名称不能为空");
      return;
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const drawerParentTask = task?.parentTaskId
    ? allTasks.find((candidate) => candidate.id === task.parentTaskId)
    : null;

  return (
    <DrawerShell
      open={Boolean(task)}
      title={task?.title ?? "任务详情"}
      eyebrow="任务档案"
      wide
      onClose={onClose}
    >
      {task?.parentTaskId && (
        <div className="task-parent-return" aria-label="父任务导航">
          {drawerParentTask ? (
            <button
              type="button"
              onClick={() => {
                setTab("structure");
                onOpenTask(drawerParentTask.id);
              }}
            >
              <span aria-hidden="true">←</span>
              返回父任务：{drawerParentTask.title}
            </button>
          ) : (
            <span>父任务暂不可用</span>
          )}
        </div>
      )}
      <div className="drawer-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "details"}
          className={tab === "details" ? "active" : ""}
          onClick={() => setTab("details")}
        >
          详情
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "structure"}
          className={tab === "structure" ? "active" : ""}
          onClick={() => setTab("structure")}
        >
          结构与重复
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          变更历史
        </button>
      </div>
      {tab === "details" ? (
        <form className="drawer-body detail-form" onSubmit={submit}>
          <label className="field field-full">
            <span>任务名称</span>
            <input
              value={draft.title ?? ""}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          {task && (
            <DescriptionImagesEditor
              key={task.id}
              task={task}
              api={api}
              value={draft.description ?? ""}
              onChange={(description) => setDraft((current) => ({ ...current, description }))}
            />
          )}
          <div className="field-grid">
            <label className="field">
              <span>温度</span>
              <select
                value={draft.temperature ?? "warm"}
                onChange={(event) =>
                  setDraft({ ...draft, temperature: event.target.value as Temperature })
                }
              >
                {Object.entries(temperatureLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>状态</span>
              <select
                value={draft.status ?? "todo"}
                onChange={(event) =>
                  setDraft({ ...draft, status: event.target.value as TaskStatus })
                }
              >
                {task && [task.status, ...statusTransitions[task.status]].map((value) => (
                  <option key={value} value={value}>{statusLabels[value]}</option>
                ))}
              </select>
            </label>
            <label
              className="field"
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
              <span>Deadline <small>设置后即硬任务</small></span>
              <input
                type="date"
                value={draft.deadline ?? ""}
                onChange={(event) => setDraft({ ...draft, deadline: event.target.value || null })}
              />
            </label>
            <label
              className="field"
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
                type="date"
                value={draft.plannedDate ?? ""}
                onChange={(event) => setDraft({ ...draft, plannedDate: event.target.value || null })}
              />
            </label>
            <label className="field">
              <span>综合分</span>
              <input value={task?.score ?? "待评估"} disabled />
            </label>
            <label className="field">
              <span>关联目标</span>
              <select
                value={draft.goalId ?? ""}
                onChange={(event) => setDraft({ ...draft, goalId: event.target.value || null })}
              >
                <option value="">未关联目标</option>
                {goals.filter((goal) => goal.status === "active").map((goal) => (
                  <option value={goal.id} key={goal.id}>{goal.title}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="field field-full tag-field">
            <span>标签 <small>可连续添加，最多 50 个</small></span>
            {(draft.tags ?? []).length > 0 && (
              <div className="tag-chips" aria-label="已添加标签">
                {(draft.tags ?? []).map((tag) => (
                  <span className="tag-chip" key={tag}>
                    #{tag}
                    <button
                      type="button"
                      aria-label={`移除标签 ${tag}`}
                      onClick={() => setDraft((current) => ({
                        ...current,
                        tags: (current.tags ?? []).filter((item) => item !== tag),
                      }))}
                    >×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="tag-entry">
              <input
                aria-label="添加标签"
                value={tagInput}
                maxLength={50}
                disabled={(draft.tags ?? []).length >= 50}
                placeholder="输入标签后按 Enter，例如：个人成长"
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={handleTagKeyDown}
              />
              <button
                type="button"
                className="button button-secondary"
                disabled={!tagInput.trim() || (draft.tags ?? []).length >= 50}
                onClick={commitTags}
              >添加</button>
            </div>
          </div>
          {error && <div className="inline-error" role="alert">{error}</div>}
          <footer className="drawer-footer">
            <button type="button" className="button button-secondary" onClick={onClose}>取消</button>
            <button type="submit" className="button button-primary" disabled={saving}>
              {saving ? "保存中…" : "保存更改"}
            </button>
          </footer>
        </form>
      ) : tab === "structure" && task ? (
        <TaskStructure
          key={task.id}
          task={task}
          api={api}
          allTasks={allTasks}
          onOpenTask={(taskId, targetTab) => {
            setTab(targetTab);
            onOpenTask(taskId);
          }}
          onChanged={onStructureChanged}
        />
      ) : (
        <div className="drawer-body history-panel">
          {historyState === "loading" && (
            <div className="history-loading">
              <span /><span /><span />
            </div>
          )}
          {historyState === "error" && (
            <div className="inline-error">历史记录暂时无法读取，切换页签后可重试。</div>
          )}
          {historyState === "idle" && history.length === 0 && (
            <div className="mini-empty">
              <span>◌</span>
              <p>还没有变更记录</p>
            </div>
          )}
          {history.map((event) => (
            <article className="history-event" key={event.id}>
              <span className={`actor-dot actor-${event.actor}`} />
              <div>
                <strong>{event.summary}</strong>
                <p>
                  {readableValue(event.oldValue)}
                  <span aria-hidden="true"> → </span>
                  {readableValue(event.newValue)}
                </p>
                <small>{event.actor === "user" ? "你" : event.actor === "ai" ? "AI" : "规则"} · {relativeTime(event.createdAt)}</small>
              </div>
            </article>
          ))}
        </div>
      )}
    </DrawerShell>
  );
}

export function TaskStructure({
  task,
  api,
  allTasks,
  onOpenTask,
  onChanged,
}: {
  task: Task;
  api: LifeOSApi;
  allTasks: Task[];
  onOpenTask: (taskId: string, targetTab: "details" | "structure") => void;
  onChanged: () => Promise<void>;
}): ReactElement {
  const [subtasks, setSubtasks] = useState<Task[]>(() => knownDirectSubtasks(task.id, allTasks));
  const [subtaskLoadState, setSubtaskLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  const [progress, setProgress] = useState<TaskProgress>({ completed: 0, total: 0, percent: 0 });
  const [templates, setTemplates] = useState<RepeatTemplate[]>([]);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [predecessorId, setPredecessorId] = useState("");
  const [dependencyQuery, setDependencyQuery] = useState("");
  const [dependencyOpen, setDependencyOpen] = useState(false);
  const [activeDependencyIndex, setActiveDependencyIndex] = useState(0);
  const [cronExpr, setCronExpr] = useState("0 9 * * 1");
  const [busy, setBusy] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [draggingSubtaskId, setDraggingSubtaskId] = useState<string | null>(null);
  const [subtaskDropTarget, setSubtaskDropTarget] = useState<{
    id: string;
    position: TaskDropPosition;
  } | null>(null);
  const [reorderNotice, setReorderNotice] = useState("");
  const [error, setError] = useState("");
  const structureRequestId = useRef(0);

  const loadStructure = useCallback(async (): Promise<void> => {
    const requestId = ++structureRequestId.current;
    setError("");
    setSubtaskLoadState("loading");
    const [subtaskResult, dependencyResult, progressResult, templateResult] = await Promise.allSettled([
      api.getSubtasks(task.id),
      api.getDependencies(task.id),
      api.getTaskProgress(task.id),
      api.getRepeatTemplates(),
    ]);
    if (requestId !== structureRequestId.current) return;
    setSubtasks((current) => subtasksAfterLoad(current, subtaskResult));
    if (subtaskResult.status === "fulfilled") {
      setSubtaskLoadState("ready");
    } else {
      setSubtaskLoadState("error");
    }
    if (dependencyResult.status === "fulfilled") setDependencies(dependencyResult.value);
    if (progressResult.status === "fulfilled") setProgress(progressResult.value);
    if (templateResult.status === "fulfilled") setTemplates(templateResult.value);
    if ([subtaskResult, dependencyResult, progressResult].some((result) => result.status === "rejected")) setError("部分结构数据暂时无法读取。");
  }, [api, task.id]);

  useEffect(() => {
    void loadStructure();
    return () => {
      structureRequestId.current += 1;
    };
  }, [loadStructure]);

  useEffect(() => {
    setPredecessorId("");
    setDependencyQuery("");
    setDependencyOpen(false);
    setActiveDependencyIndex(0);
  }, [task.id]);

  async function addSubtask(): Promise<void> {
    if (!subtaskTitle.trim() || hierarchyDepth(task, allTasks) >= 3) return;
    setBusy(true);
    try {
      await api.createSubtask(task.id, {
        title: subtaskTitle.trim(),
        temperature: task.temperature,
        plannedDate: task.plannedDate,
      });
      setSubtaskTitle("");
      await Promise.all([loadStructure(), onChanged()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "子任务创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function persistSubtaskOrder(nextIds: string[]): Promise<void> {
    const currentIds = subtasks.map((item) => item.id);
    if (
      reordering ||
      nextIds.length !== currentIds.length ||
      nextIds.every((id, index) => id === currentIds[index])
    ) return;
    const previous = subtasks;
    const byId = new Map(previous.map((item) => [item.id, item]));
    const optimistic = nextIds.map((id) => byId.get(id)).filter((item): item is Task => Boolean(item));
    if (optimistic.length !== previous.length) return;
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
      setError(reason instanceof Error ? reason.message : "子任务排序失败，已恢复原顺序");
      setReorderNotice("排序失败，已恢复原顺序。");
      return;
    } finally {
      setReordering(false);
    }
    try {
      await onChanged();
    } catch {
      setError("子任务顺序已保存，但任务列表暂时无法刷新。");
    }
  }

  function handleSubtaskKeyboard(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    subtaskId: string,
  ): void {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (subtaskLoadState === "loading" || reordering) return;
    void persistSubtaskOrder(reorderSubtaskIdsByKey(
      subtasks.map((item) => item.id),
      subtaskId,
      event.key as SubtaskReorderKey,
    ));
  }

  function handleSubtaskDragStart(event: ReactDragEvent<HTMLDivElement>, subtaskId: string): void {
    if (subtaskLoadState === "loading" || reordering || subtasks.length < 2) {
      event.preventDefault();
      return;
    }
    setDraggingSubtaskId(subtaskId);
    setSubtaskDropTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", subtaskId);
  }

  function handleSubtaskDragOver(event: ReactDragEvent<HTMLDivElement>, targetId: string): void {
    const sourceId = draggingSubtaskId ?? event.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === targetId || reordering) {
      setSubtaskDropTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    setSubtaskDropTarget({
      id: targetId,
      position: taskDropPosition(event.clientY, bounds.top, bounds.height),
    });
  }

  function handleSubtaskDrop(event: ReactDragEvent<HTMLDivElement>, targetId: string): void {
    event.preventDefault();
    const sourceId = draggingSubtaskId ?? event.dataTransfer.getData("text/plain");
    const bounds = event.currentTarget.getBoundingClientRect();
    setDraggingSubtaskId(null);
    setSubtaskDropTarget(null);
    if (!sourceId || sourceId === targetId || reordering) return;
    void persistSubtaskOrder(reorderSubtaskIds(
      subtasks.map((item) => item.id),
      sourceId,
      targetId,
      taskDropPosition(event.clientY, bounds.top, bounds.height),
    ));
  }

  async function addDependency(): Promise<void> {
    if (!predecessorId) return;
    setBusy(true);
    try {
      await api.addDependency(task.id, predecessorId);
      setPredecessorId("");
      setDependencyQuery("");
      setDependencyOpen(false);
      await Promise.all([loadStructure(), onChanged()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "依赖创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeDependency(dependencyId: string): Promise<void> {
    setBusy(true);
    try {
      await api.deleteDependency(task.id, dependencyId);
      await Promise.all([loadStructure(), onChanged()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "依赖删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function createRepeat(): Promise<void> {
    const validationError = cronExpressionError(cronExpr);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
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
      await Promise.all([loadStructure(), onChanged()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重复模板创建失败");
    } finally {
      setBusy(false);
    }
  }

  const depth = hierarchyDepth(task, allTasks);
  const parentTask = task.parentTaskId
    ? allTasks.find((item) => item.id === task.parentTaskId)
    : null;
  const candidateOptions = useMemo(
    () => dependencyCandidateOptions(task.id, allTasks, dependencies, dependencyQuery),
    [allTasks, dependencies, dependencyQuery, task.id],
  );
  const incomingDependencies = dependencies.filter((item) => item.successorId === task.id);
  const visibleDependencyIndex = activeDependencyIndex < candidateOptions.length ? activeDependencyIndex : 0;
  const activeDependency = candidateOptions[visibleDependencyIndex];
  const cronError = cronExpressionError(cronExpr);
  const relatedTemplate = templates.find((item) => item.id === task.repeatTemplateId);
  const canReorderSubtasks = subtasks.length > 1 && subtaskLoadState !== "loading" && !reordering;

  function chooseDependency(option: DependencyCandidateOption): void {
    setPredecessorId(option.task.id);
    setDependencyQuery(option.label);
    setDependencyOpen(false);
  }

  function handleDependencyKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      setDependencyOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    if (candidateOptions.length === 0) return;
    event.preventDefault();
    if (event.key === "Enter") {
      if (dependencyOpen) chooseDependency(candidateOptions[visibleDependencyIndex]!);
      return;
    }
    setDependencyOpen(true);
    setActiveDependencyIndex((current) => {
      if (event.key === "ArrowDown") return dependencyOpen ? (current + 1) % candidateOptions.length : 0;
      return dependencyOpen ? (current - 1 + candidateOptions.length) % candidateOptions.length : candidateOptions.length - 1;
    });
  }
  return (
    <div className="drawer-body structure-panel">
      {error && <div className="inline-error">{error}</div>}
      <section className="structure-section" aria-label="任务归属">
        <header>
          <div>
            <h3>任务归属</h3>
            <p>在父子任务之间切换，不改变任务状态。</p>
          </div>
          {parentTask ? (
            <button
              type="button"
              className="button button-secondary"
              aria-label={`打开父任务 ${parentTask.title}`}
              onClick={() => onOpenTask(parentTask.id, "structure")}
            >
              隶属于：{parentTask.title}
            </button>
          ) : (
            <strong>{task.parentTaskId ? "隶属于：父任务暂不可用" : "隶属于：顶层任务"}</strong>
          )}
        </header>
      </section>
      <section className="structure-section">
        <header>
          <div><h3>子任务</h3><p>当前层级 {depth} / 3</p></div>
          <strong>{progress.percent}%</strong>
        </header>
        <div className="progress-track"><i style={{ width: `${progress.percent}%` }} /></div>
        <div
          className="subtask-list"
          aria-busy={subtaskLoadState === "loading" || reordering}
          aria-label="子任务列表"
        >
          {subtasks.length === 0 && subtaskLoadState === "loading" ? (
            <p className="muted subtask-state">正在加载子任务…</p>
          ) : subtasks.length === 0 && subtaskLoadState === "error" ? (
            <p className="muted subtask-state">子任务暂时无法读取，请稍后重试。</p>
          ) : subtasks.length === 0 ? (
            <p className="muted subtask-state">还没有子任务。</p>
          ) : subtasks.map((item) => {
            const dropPosition = subtaskDropTarget?.id === item.id
              ? subtaskDropTarget.position
              : null;
            return (
              <div
                className={`subtask-row ${draggingSubtaskId === item.id ? "is-dragging" : ""} ${dropPosition ? `is-drop-${dropPosition}` : ""}`}
                key={item.id}
                role="button"
                tabIndex={0}
                aria-label={`打开子任务 ${item.title}`}
                draggable={canReorderSubtasks}
                onClick={() => onOpenTask(item.id, "details")}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenTask(item.id, "details");
                  }
                }}
                onDragStart={(event) => handleSubtaskDragStart(event, item.id)}
                onDragOver={(event) => handleSubtaskDragOver(event, item.id)}
                onDrop={(event) => handleSubtaskDrop(event, item.id)}
                onDragEnd={() => {
                  setDraggingSubtaskId(null);
                  setSubtaskDropTarget(null);
                }}
              >
                <button
                  type="button"
                  className="subtask-drag-handle"
                  aria-label={`调整子任务顺序：${item.title}`}
                  title="拖动排序；方向键微调，Home/End 移到首尾"
                  disabled={!canReorderSubtasks}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => handleSubtaskKeyboard(event, item.id)}
                >⋮⋮</button>
                <span aria-hidden="true">{item.status === "completed" ? "✓" : "○"}</span>
                <strong>{item.title}</strong>
                <small>{temperatureLabels[item.temperature]}</small>
              </div>
            );
          })}
        </div>
        <p className="sr-only" role="status" aria-live="polite">{reorderNotice}</p>
        {depth < 3 ? <><div className="structure-add"><input value={subtaskTitle} placeholder="添加一个子任务…" onChange={(event) => setSubtaskTitle(event.target.value)} /><button className="button button-secondary" disabled={busy || reordering || !subtaskTitle.trim()} onClick={() => void addSubtask()}>添加</button></div><p className="muted">新子任务会继承当前任务的标签与状态，创建后可单独修改。</p></> : <p className="structure-limit">已到达 3 层上限，请在现有层级中继续拆解。</p>}
      </section>
      <section className="structure-section"><header><div><h3>前置依赖</h3><p>前置未完成时，任务会被阻塞。</p></div>{task.isBlocked && <strong className="blocked-label">🔒 已阻塞</strong>}</header>
        <div className="dependency-list">{incomingDependencies.length === 0 ? <p className="muted">没有前置任务。</p> : incomingDependencies.map((item) => {
          const predecessor = allTasks.find((candidate) => candidate.id === item.predecessorId);
          const presentation = predecessor ? dependencyCandidateOption(predecessor, allTasks) : null;
          return <div key={item.id}><span>←</span><span><strong>{predecessor?.title ?? "未知任务"}</strong>{presentation && <small>{presentation.ancestorPath ? `隶属 ${presentation.ancestorPath} · ` : ""}{presentation.statusLabel} · #{presentation.shortId}</small>}</span><button type="button" aria-label={`删除前置依赖 ${predecessor?.title ?? "未知任务"}`} disabled={busy} onClick={() => void removeDependency(item.id)}>×</button></div>;
        })}</div>
        <div className="structure-add dependency-add">
          <div
            className="dependency-combobox"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setDependencyOpen(false);
            }}
          >
            <label className="sr-only" htmlFor="dependency-search">搜索前置任务</label>
            <input
              id="dependency-search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={dependencyOpen}
              aria-controls="dependency-options"
              aria-activedescendant={dependencyOpen && activeDependency ? `dependency-option-${visibleDependencyIndex}` : undefined}
              autoComplete="off"
              value={dependencyQuery}
              placeholder="输入标题、父链、状态或任务 ID…"
              onFocus={() => {
                setDependencyOpen(true);
                setActiveDependencyIndex(0);
              }}
              onChange={(event) => {
                setDependencyQuery(event.target.value);
                setPredecessorId("");
                setDependencyOpen(true);
                setActiveDependencyIndex(0);
              }}
              onKeyDown={handleDependencyKeyDown}
            />
            {dependencyOpen && (
              <div className="dependency-options" id="dependency-options" role="listbox" aria-label="可选前置任务">
                {candidateOptions.length === 0 ? <div className="dependency-empty" role="option" aria-disabled="true">没有匹配的可关联任务</div> : candidateOptions.map((option, index) => (
                  <button
                    type="button"
                    id={`dependency-option-${index}`}
                    role="option"
                    aria-selected={option.task.id === predecessorId}
                    className={index === visibleDependencyIndex ? "is-active" : ""}
                    key={option.task.id}
                    tabIndex={-1}
                    onMouseMove={() => setActiveDependencyIndex(index)}
                    onClick={() => chooseDependency(option)}
                  >
                    <strong>{option.task.title}</strong>
                    <small>{option.ancestorPath ? `隶属 ${option.ancestorPath}` : "顶层任务"} · {option.statusLabel} · #{option.shortId}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="button button-secondary" disabled={busy || !predecessorId} onClick={() => void addDependency()}>关联</button>
        </div>
      </section>
      <section className="structure-section"><header><div><h3>重复计划</h3><p>模板只负责生成实例，不改写历史任务。</p></div></header>
        {relatedTemplate ? <div className="repeat-state"><strong>↻ {relatedTemplate.cronExpr}</strong><span>{relatedTemplate.enabled ? "已启用" : "已停用"}，最近生成 {relatedTemplate.lastGenerated ?? "—"}</span><button className="button button-secondary" onClick={() => void api.generateRepeatTemplate(relatedTemplate.id)}>立即生成</button></div> : (
          <div className="repeat-editor">
            <label className="repeat-preset">
              <span>常用示例</span>
              <select
                value=""
                onChange={(event) => {
                  if (!event.target.value) return;
                  setCronExpr(event.target.value);
                  setError("");
                }}
              >
                <option value="">选择一个常用规则…</option>
                {cronExamples.map((example) => <option value={example.value} key={example.value}>{example.label} · {example.value}</option>)}
              </select>
            </label>
            <div className="repeat-custom-row">
              <label>
                <span>自定义 Cron 表达式</span>
                <input
                  value={cronExpr}
                  aria-invalid={Boolean(cronError)}
                  aria-describedby={`cron-help${cronError ? " cron-error" : ""}`}
                  onChange={(event) => {
                    setCronExpr(event.target.value);
                    setError("");
                  }}
                />
              </label>
              <button type="button" className="button button-secondary" disabled={busy || Boolean(cronError)} onClick={() => void createRepeat()}>创建重复模板</button>
            </div>
            <div className="cron-guide" id="cron-help">
              <div className="cron-field-order" aria-label="Cron 字段顺序">
                {cronFields.map((field) => <span key={field.name}><b>{field.name}</b><small>{field.min}–{field.max}</small></span>)}
              </div>
              <p>顺序固定为「分 时 日 月 周」。支持 <code>*</code> 任意值、<code>,</code> 多个值、<code>-</code> 范围和 <code>/</code> 步长；周 0 或 7 都表示周日，不支持英文星期或月份名。</p>
              <p>「日」与「周」都填写具体条件时按 <strong>OR</strong> 匹配，满足任意一项即生成。时间按模板时区解释；此处新建默认为 <code>Asia/Shanghai</code>（系统工作区的默认值也相同）。</p>
            </div>
            {cronError && <p className="cron-error" id="cron-error" role="alert">{cronError}</p>}
          </div>
        )}
      </section>
    </div>
  );
}

interface AiDrawerProps {
  open: boolean;
  cards: AiCard[];
  degraded: boolean;
  demoMode: boolean;
  generating: boolean;
  onClose: () => void;
  onDecision: (card: AiCard, decision: "accept" | "reject") => Promise<void>;
  onDiscuss: (card: AiCard, message: string) => Promise<void>;
  onSend: (card: AiCard, content: string) => Promise<void>;
  onGenerate: () => Promise<void>;
}

export function AiDrawer({
  open,
  cards,
  degraded,
  demoMode,
  generating,
  onClose,
  onDecision,
  onDiscuss,
  onSend,
  onGenerate,
}: AiDrawerProps): ReactElement | null {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const selected = cards.find((card) => card.id === selectedId) ?? null;
  const activeCards = cards.filter((card) => card.status !== "archived");

  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setMessage("");
    }
  }, [open]);

  async function submitMessage(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!selected || !message.trim()) return;
    setSending(true);
    try {
      if (selected.status === "discussing") {
        await onSend(selected, message.trim());
      } else {
        await onDiscuss(selected, message.trim());
      }
      setMessage("");
    } finally {
      setSending(false);
    }
  }

  return (
    <DrawerShell
      open={open}
      title={selected ? selected.title : "AI 教练"}
      eyebrow={selected ? "与这张卡继续聊" : "人做最终决定"}
      wide
      onClose={selected ? () => setSelectedId(null) : onClose}
    >
      {selected ? (
        <div className="conversation-layout">
          <div className="conversation-context">
            <span className={`card-type card-type-${selected.type}`}>
              {cardTypeLabels[selected.type]}
            </span>
            <p>{selected.body}</p>
            {selected.suggestedAction && <strong>{selected.suggestedAction}</strong>}
          </div>
          <div className="message-list">
            {(selected.messages ?? []).length === 0 ? (
              <div className="conversation-empty">
                <CoachIcon className="conversation-coach-icon" />
                <p>说说你为什么犹豫，AI 会把上下文写回这张卡。</p>
              </div>
            ) : (
              selected.messages?.map((item) => (
                <div className={`message message-${item.role}`} key={item.id}>
                  <span>{item.role === "user" ? "你" : "AI"}</span>
                  <p>{item.content}</p>
                </div>
              ))
            )}
          </div>
          <form className="message-composer" onSubmit={submitMessage}>
            <textarea
              rows={3}
              value={message}
              placeholder="输入你的考虑…"
              onChange={(event) => setMessage(event.target.value)}
            />
            <button className="button button-primary" disabled={sending || !message.trim()}>
              {sending ? "发送中…" : "发送"}
            </button>
          </form>
        </div>
      ) : (
        <div className="drawer-body ai-panel">
          {(degraded || demoMode) && (
            <div className="degraded-banner">
              <span aria-hidden="true">◐</span>
              <div>
                <strong>{degraded ? "AI 暂时离线" : "本地建议模式"}</strong>
                <p>{degraded ? "任务管理不受影响，建议恢复后会重新加载。" : "卡片由可解释规则生成，不会调用外部模型。"}</p>
              </div>
            </div>
          )}
          <button
            type="button"
            className="generate-card-button"
            disabled={generating || degraded}
            onClick={() => void onGenerate()}
          >
            <span className="summary-orb">∗</span>
            <span>
              <strong>{generating ? "正在整理今天…" : "生成今日小结"}</strong>
              <small>根据今日任务与变更生成一张新卡</small>
            </span>
            <span aria-hidden="true">→</span>
          </button>
          {activeCards.length === 0 ? (
            <div className="mini-empty tall">
              <span>✓</span>
              <h3>建议已处理完</h3>
              <p>当发现新模式时，AI 会在这里找你。</p>
            </div>
          ) : (
            <div className="ai-card-list">
              {activeCards.map((card) => (
                <article className={`ai-card card-${card.type}`} key={card.id}>
                  <header>
                    <span className={`card-type card-type-${card.type}`}>
                      {cardTypeLabels[card.type]}
                    </span>
                    <small>{relativeTime(card.createdAt)}</small>
                  </header>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                  {card.suggestedAction && (
                    <div className="suggested-action">
                      <span>建议动作</span>
                      <strong>{card.suggestedAction}</strong>
                    </div>
                  )}
                  {card.status === "pending" || card.status === "discussing" ? (
                    <footer>
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={() => void onDecision(card, "accept")}
                      >
                        {card.type === "observation" ? "记下了" : "接受"}
                      </button>
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => void onDecision(card, "reject")}
                      >
                        {card.type === "observation" ? "忽略" : "拒绝"}
                      </button>
                      <button type="button" className="text-button" onClick={() => setSelectedId(card.id)}>
                        {card.status === "discussing" ? "继续讨论" : "讨论"}
                      </button>
                    </footer>
                  ) : (
                    <div className={`decision-state decision-${card.status}`}>
                      {card.status === "accepted" ? "✓ 已接受" : "— 已拒绝"}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </DrawerShell>
  );
}

interface RulesDrawerProps {
  open: boolean;
  rules: Rule[];
  error: boolean;
  evaluating: boolean;
  onClose: () => void;
  onUpdate: (
    rule: Rule,
    patch: Partial<Pick<Rule, "enabled" | "parameters">>,
  ) => Promise<void>;
  onEvaluate: () => Promise<void>;
  onRetry: () => Promise<void>;
}

function RuleCard({
  rule,
  onUpdate,
}: Pick<RulesDrawerProps, "onUpdate"> & { rule: Rule }): ReactElement {
  const [parameters, setParameters] = useState(rule.parameters);
  const [saving, setSaving] = useState(false);

  useEffect(() => setParameters(rule.parameters), [rule.parameters]);

  async function saveParameters(): Promise<void> {
    setSaving(true);
    try {
      await onUpdate(rule, { parameters });
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className={`rule-card ${rule.enabled ? "enabled" : ""}`}>
      <header>
        <div>
          <h3>{rule.name}</h3>
          <p>{rule.description}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={rule.enabled}
          aria-label={`${rule.name}：${rule.enabled ? "已开启" : "已关闭"}`}
          className={`switch ${rule.enabled ? "on" : ""}`}
          onClick={() => void onUpdate(rule, { enabled: !rule.enabled })}
        >
          <span />
        </button>
      </header>
      <div className="rule-parameters">
        {Object.entries(parameters).map(([key, value]) => (
          <label key={key}>
            <span>{key === "days" ? "天数" : key === "hour" ? "小时" : key}</span>
            <input
              type={typeof value === "number" ? "number" : "text"}
              min={typeof value === "number" ? 1 : undefined}
              value={String(value)}
              onChange={(event) =>
                setParameters({
                  ...parameters,
                  [key]: typeof value === "number" ? Number(event.target.value) : event.target.value,
                })
              }
              onBlur={() => void saveParameters()}
            />
          </label>
        ))}
        <small>{saving ? "正在保存…" : rule.lastTriggeredAt ? `最近触发 ${relativeTime(rule.lastTriggeredAt)}` : "尚未触发"}</small>
      </div>
    </article>
  );
}

export function RulesDrawer({
  open,
  rules,
  error,
  evaluating,
  onClose,
  onUpdate,
  onEvaluate,
  onRetry,
}: RulesDrawerProps): ReactElement | null {
  return (
    <DrawerShell open={open} title="自动化规则" eyebrow="让系统守住底线" onClose={onClose}>
      <div className="drawer-body rules-panel">
        <div className="rules-intro">
          <p>规则只在明确条件下执行，每次变更都会留下历史。</p>
          <button
            type="button"
            className="button button-secondary"
            disabled={evaluating || error}
            onClick={() => void onEvaluate()}
          >
            {evaluating ? "检查中…" : "立即检查"}
          </button>
        </div>
        {error ? (
          <div className="drawer-error-state">
            <span>！</span>
            <h3>规则暂时无法读取</h3>
            <p>任务可继续管理，恢复后再返回检查。</p>
            <button type="button" className="button button-secondary" onClick={() => void onRetry()}>重试</button>
          </div>
        ) : rules.length === 0 ? (
          <div className="mini-empty tall"><span>◌</span><p>还没有可用规则</p></div>
        ) : (
          <div className="rule-list">
            {rules.map((rule) => <RuleCard key={rule.id} rule={rule} onUpdate={onUpdate} />)}
          </div>
        )}
      </div>
    </DrawerShell>
  );
}
