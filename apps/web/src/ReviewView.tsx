import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { LifeOSApi } from "./api";
import type { CarryoverAction, Goal, MorningPlanningData, ReviewCard, Task } from "./types";
import {
  carryoverDecisionsFromDrafts,
  dailyReviewTasks,
  localDate,
  monthlyGoalReviewRows,
  taskCompletionRate,
  wasCompleted,
  weeklyCompletionTrend,
  weeklyGoalAggregates,
} from "./v02-utils";
import type { CarryoverDraft } from "./v02-utils";

interface MorningPlannerProps {
  api: LifeOSApi;
  tasks: Task[];
  onChanged: () => Promise<void>;
  onReview: (type: "daily" | "weekly" | "monthly", date: string) => void;
  onToast: (message: string) => void;
}

export function MorningPlanner({ api, tasks, onChanged, onReview, onToast }: MorningPlannerProps): ReactElement {
  const date = localDate(new Date());
  const [data, setData] = useState<MorningPlanningData | null>(null);
  const [open, setOpen] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, CarryoverDraft>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void api.getMorning(date).then((value) => {
      if (!active) return;
      setData(value);
      setDecisions(Object.fromEntries(value.unfinished.map((task) => [task.id, {
        taskId: task.id,
        action: "carry_today",
        targetDate: "",
      }])));
    }).catch(() => setData(null));
    return () => { active = false; };
  }, [api, date]);

  async function confirm(): Promise<void> {
    const values = carryoverDecisionsFromDrafts(Object.values(decisions));
    if (!values) {
      onToast("请先为所有改期任务选择新计划日");
      return;
    }
    setSaving(true);
    try {
      if (values.length) await api.carryover(date, values);
      const plannedIds = Array.from(new Set([
        ...(data?.planned ?? []).map((task) => task.id),
        ...values.filter((item) => item.action === "carry_today").map((item) => item.taskId),
      ]));
      await api.createDailyPlan(date, plannedIds, values);
      await onChanged();
      setOpen(false);
      onToast("今日计划已确认");
    } catch (reason) {
      onToast(reason instanceof Error ? reason.message : "计划保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className="today-rhythm">
        <div><p className="eyebrow">每日节律</p><strong>{data?.unfinished.length ? `昨日有 ${data.unfinished.length} 项未完成` : "今日计划已就位"}</strong><span>先决定任务去向，晚上再复盘。</span></div>
        <div><button className="button button-secondary" onClick={() => setOpen(true)}>{data?.unfinished.length ? "晨起规划" : "确认今日计划"}</button><button className="button button-primary" onClick={() => onReview("daily", date)}>开始每日复盘</button></div>
      </section>
      <div className="review-shortcuts"><button onClick={() => onReview("weekly", date)}>周复盘</button><button onClick={() => onReview("monthly", date)}>月复盘</button><span>今日已完成 {tasks.filter((task) => task.status === "completed").length} 项</span></div>
      {open && data && (
        <div className="v02-modal-layer"><button className="v02-modal-backdrop" onClick={() => setOpen(false)} aria-label="关闭" /><aside className="v02-panel morning-panel">
          <header><div><p className="eyebrow">{date}</p><h2>晨起规划</h2></div><button className="icon-button" onClick={() => setOpen(false)}>×</button></header>
          <p className="morning-intro">每个未完成任务都需要一个明确去向，不让它们默默滚动。</p>
          {data.unfinished.length === 0 ? <div className="v02-empty compact"><span>✓</span><p>没有遗留任务，可以直接确认今日计划。</p></div> : <div className="carryover-list">{data.unfinished.map((task) => <CarryoverRow key={task.id} task={task} value={decisions[task.id]} onChange={(value) => setDecisions((current) => ({ ...current, [task.id]: value }))} />)}</div>}
          <footer className="morning-footer"><span>今日已规划 {data.planned.length} 项，Deadline {data.deadlineToday.length} 项</span><button className="button button-primary" disabled={saving} onClick={() => void confirm()}>{saving ? "保存中…" : "确认今日计划"}</button></footer>
        </aside></div>
      )}
    </>
  );
}

function CarryoverRow({ task, value, onChange }: { task: Task; value: CarryoverDraft | undefined; onChange: (value: CarryoverDraft) => void }): ReactElement {
  const action = value?.action ?? "carry_today";
  return <article className="carryover-row"><div><strong>{task.title}</strong><small>原计划日 {task.plannedDate?.slice(0, 10) ?? "—"}</small></div><select value={action} onChange={(event) => {
    const nextAction = event.currentTarget.value as CarryoverAction;
    onChange({ taskId: task.id, action: nextAction, targetDate: nextAction === "reschedule" ? value?.targetDate ?? "" : "" });
  }}><option value="carry_today">带到今天</option><option value="reschedule">改期</option><option value="cool_down">降为冷</option><option value="abandon">放弃</option></select>{action === "reschedule" && <input required aria-label={`${task.title}的新计划日`} type="date" min={localDate(new Date())} value={value?.targetDate ?? ""} onChange={(event) => onChange({ taskId: task.id, action: "reschedule", targetDate: event.currentTarget.value })} />}</article>;
}

interface ReviewViewProps {
  api: LifeOSApi;
  type: "daily" | "weekly" | "monthly";
  date: string;
  onBack: () => void;
  onToast: (message: string) => void;
}

export function ReviewView({ api, type, date, onBack, onToast }: ReviewViewProps): ReactElement {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [focusMinutes, setFocusMinutes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const reviewType = type === "daily" ? "daily_review" : type === "weekly" ? "weekly_review" : "monthly_review";
  const title = { daily: "每日复盘", weekly: "周复盘", monthly: "月复盘" }[type];

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    const [taskResult, cardResult, planResult, goalResult] = await Promise.allSettled([
      api.getTasks(),
      api.getReviews(reviewType, date),
      api.getReviews("daily_plan", date),
      api.getGoals("active"),
    ]);
    const allTasks = taskResult.status === "fulfilled" ? taskResult.value : [];
    const planCards = planResult.status === "fulfilled" ? planResult.value : [];
    setTasks(dailyReviewTasks(allTasks, planCards[0]?.content.plannedTasks, date));
    setCards(cardResult.status === "fulfilled" ? cardResult.value : []);
    setGoals(goalResult.status === "fulfilled" ? goalResult.value : []);
    setLoading(false);
  }, [api, date, reviewType]);

  useEffect(() => {
    void load();
  }, [load]);

  const completed = tasks.filter(wasCompleted);
  const incomplete = tasks.filter((task) => !wasCompleted(task));
  const completionRate = taskCompletionRate(tasks);
  const missingReason = incomplete.some((task) => !reasons[task.id]?.trim());

  async function submitDaily(): Promise<void> {
    if (missingReason) {
      onToast("请为每个未完成任务补充原因");
      return;
    }
    setSaving(true);
    try {
      await api.createDailyReview(date, {
        plannedTasks: tasks.map((task) => ({ taskId: task.id, title: task.title, completed: wasCompleted(task) })),
        unplannedCompleted: [],
        completionRate,
        incompleteReasons: incomplete.map((task) => ({ taskId: task.id, reason: reasons[task.id]! })),
        totalFocusMinutes: focusMinutes,
      });
      onToast("每日复盘已保存");
      await load();
    } catch (reason) {
      onToast(reason instanceof Error ? reason.message : "复盘保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function generate(): Promise<void> {
    setSaving(true);
    try {
      await api.generateReview(type as "weekly" | "monthly", date);
      onToast(`${title}已生成`);
      await load();
    } catch (reason) {
      onToast(reason instanceof Error ? reason.message : "复盘生成失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="board v02-page review-page" aria-labelledby="review-title">
      <header className="v02-page-header"><div><button className="review-back" onClick={onBack}>← 返回今日</button><p className="eyebrow">{date}</p><h1 id="review-title">{title}</h1></div>{type !== "daily" && <button className="button button-primary" disabled={saving} onClick={() => void generate()}>{saving ? "正在整理…" : `生成${title}`}</button>}</header>
      {loading ? <div className="v02-loading">正在汇总事实…</div> : type === "daily" ? (
        <div className="daily-review-layout">
          <section className="review-score"><span>完成率</span><strong>{completionRate}%</strong><p>{completed.length} / {tasks.length} 项完成</p><div className="progress-track"><i style={{ width: `${completionRate}%` }} /></div></section>
          <section className="review-task-section"><h2>今日任务</h2>{tasks.length === 0 ? <p className="muted">这天没有计划任务。</p> : tasks.map((task) => <article className={wasCompleted(task) ? "done" : ""} key={task.id}><span>{wasCompleted(task) ? "✓" : "○"}</span><div><strong>{task.title}</strong><small>{wasCompleted(task) ? "已完成" : "未完成"}</small></div>{!wasCompleted(task) && <input value={reasons[task.id] ?? ""} placeholder="未完成原因（必填）" onChange={(event) => setReasons((current) => ({ ...current, [task.id]: event.target.value }))} />}</article>)}</section>
          <label className="focus-minutes"><span>今日专注时长</span><input type="number" min="0" value={focusMinutes} onChange={(event) => setFocusMinutes(Math.max(0, event.target.valueAsNumber || 0))} /><small>分钟</small></label>
          <button className="button button-primary review-submit" disabled={saving || (incomplete.length > 0 && missingReason)} onClick={() => void submitDaily()}>{saving ? "保存中…" : "完成每日复盘"}</button>
          {cards.length > 0 && <ReviewHistory cards={cards} />}
        </div>
      ) : cards.length === 0 ? <div className="v02-empty"><span>∿</span><h3>还没有{title}</h3><p>点击生成，系统只会汇总已发生的任务与目标变化。</p></div> : type === "weekly" ? <WeeklyReview cards={cards} goals={goals} /> : <MonthlyReview cards={cards} goals={goals} />}
    </section>
  );
}

function WeeklyReview({ cards, goals }: { cards: ReviewCard[]; goals: Goal[] }): ReactElement {
  const titleById = new Map(goals.map((goal) => [goal.id, goal.title]));
  return <section className="review-history period-review"><h2>逐日完成率与目标聚合</h2>{cards.map((card) => {
    const trend = weeklyCompletionTrend(card.content);
    const aggregates = weeklyGoalAggregates(card.content);
    return <article className="period-review-card" key={card.id}>
      <header><strong>{card.periodStart} — {card.periodEnd}</strong><small>更新于 {new Date(card.updatedAt).toLocaleString("zh-CN")}</small></header>
      <div className="review-summary-metrics">
        <ReviewMetric label="计划" value={numberValue(card.content.plannedCount)} suffix=" 项" />
        <ReviewMetric label="完成" value={numberValue(card.content.completedCount)} suffix=" 项" />
        <ReviewMetric label="周完成率" value={numberValue(card.content.completionRate)} suffix="%" />
      </div>
      <section className="weekly-trend"><header><h3>每日计划完成率</h3><small>以当日 Daily Plan 为分母</small></header>{trend.length === 0 ? <p className="muted">暂无逐日完成率数据。</p> : <div className="weekly-bars">{trend.map((point) => <div key={point.date}><span>{point.rate}%</span><i style={{ height: `${Math.max(3, point.rate)}%` }} /><small>{weekdayLabel(point.date)}<b>{point.date.slice(5)}</b></small></div>)}</div>}</section>
      <section className="review-goal-aggregate"><h3>目标进展</h3>{aggregates.length === 0 ? <p className="muted">本周没有挂靠到目标的完成任务。</p> : <div>{aggregates.map((item) => <article key={item.goalId}><span>◎</span><strong>{titleById.get(item.goalId) ?? item.goalId}</strong><b>{item.completedCount} 项完成</b></article>)}</div>}</section>
    </article>;
  })}</section>;
}

function MonthlyReview({ cards, goals }: { cards: ReviewCard[]; goals: Goal[] }): ReactElement {
  const activeIds = new Set(goals.map((goal) => goal.id));
  const titleById = new Map(goals.map((goal) => [goal.id, goal.title]));
  return <section className="review-history period-review"><h2>活跃目标的月度进展</h2>{cards.map((card) => {
    const contentGoalIds = Array.isArray(card.content.goals) ? card.content.goals.flatMap((value) => {
      const record = recordValue(value);
      return typeof record.goalId === "string" ? [record.goalId] : [];
    }) : [];
    const visibleIds = activeIds.size ? activeIds : new Set(contentGoalIds);
    const rows = monthlyGoalReviewRows(card.content, visibleIds);
    const counts = recordValue(card.content.taskCounts);
    return <article className="period-review-card" key={card.id}>
      <header><strong>{card.periodStart} — {card.periodEnd}</strong><small>更新于 {new Date(card.updatedAt).toLocaleString("zh-CN")}</small></header>
      <div className="review-summary-metrics four">
        <ReviewMetric label="新建" value={numberValue(counts.created)} suffix=" 项" />
        <ReviewMetric label="完成" value={numberValue(counts.completed)} suffix=" 项" />
        <ReviewMetric label="放弃" value={numberValue(counts.abandoned)} suffix=" 项" />
        <ReviewMetric label="重复任务完成率" value={numberValue(card.content.repeatCompletionRate)} suffix="%" />
      </div>
      <section className="monthly-goals"><h3>每个活跃目标</h3>{rows.length === 0 ? <p className="muted">本月还没有可汇总的活跃目标。</p> : rows.map((row) => <article key={row.goalId}><div><strong>{titleById.get(row.goalId) ?? row.title}</strong><span>本月完成 {row.monthCompleted} 项</span></div><div><b>{row.percent}%</b><small>{row.completed} / {row.total} 总任务</small></div><div className="progress-track"><i style={{ width: `${row.percent}%` }} /></div></article>)}</section>
    </article>;
  })}</section>;
}

function ReviewMetric({ label, value, suffix }: { label: string; value: number; suffix: string }): ReactElement {
  return <div><span>{label}</span><strong>{value}{suffix}</strong></div>;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function weekdayLabel(date: string): string {
  return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date(`${date}T12:00:00`));
}

function ReviewHistory({ cards }: { cards: ReviewCard[] }): ReactElement {
  return <section className="review-history"><h2>已保存的复盘</h2>{cards.map((card) => <article key={card.id}><header><strong>{card.periodStart} — {card.periodEnd}</strong><small>{new Date(card.updatedAt).toLocaleString("zh-CN")}</small></header><div className="review-facts">{Object.entries(card.content).map(([key, value]) => <div key={key}><span>{reviewFieldLabel(key)}</span><strong>{reviewValue(value)}</strong></div>)}</div></article>)}</section>;
}

function reviewFieldLabel(key: string): string {
  const labels: Record<string, string> = {
    plannedCount: "计划数",
    completedCount: "完成数",
    completionRate: "完成率",
    carriedTaskIds: "顺延任务",
    totalFocusMinutes: "专注分钟",
    taskCounts: "任务变化",
    goals: "目标进度",
    plannedTasks: "计划任务",
    incompleteReasons: "未完成原因",
  };
  return labels[key] ?? key;
}

function reviewValue(value: unknown): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `${value.length} 项`;
  if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}: ${String(item)}`).join(" · ");
  return "—";
}
