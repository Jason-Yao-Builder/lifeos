import { useEffect, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode } from "react";
import type { LifeOSApi } from "./api";
import { CoachIcon } from "./Icons";
import type {
  AiCard,
  Rule,
  Task,
  TaskEvent,
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
        tags: task.tags,
      }
    : {};
}

export function TaskDrawer({ task, api, onClose, onSave }: TaskDrawerProps): ReactElement | null {
  const [tab, setTab] = useState<"details" | "history">("details");
  const [draft, setDraft] = useState<UpdateTask>(() => taskDraft(task));
  const [history, setHistory] = useState<TaskEvent[]>([]);
  const [historyState, setHistoryState] = useState<"idle" | "loading" | "error">("idle");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    setDraft(taskDraft(task));
    setTab("details");
    setError("");
    setTagInput("");
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

  return (
    <DrawerShell
      open={Boolean(task)}
      title={task?.title ?? "任务详情"}
      eyebrow="任务档案"
      wide
      onClose={onClose}
    >
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
          <label className="field field-full">
            <span>描述</span>
            <textarea
              rows={5}
              value={draft.description ?? ""}
              placeholder="补充背景、完成标准或下一步…"
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
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
