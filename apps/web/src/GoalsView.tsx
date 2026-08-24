import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import type { LifeOSApi } from "./api";
import type { Goal, GoalProgress, GoalStatus, Task } from "./types";

interface GoalsViewProps {
  api: LifeOSApi;
  onOpenTask: (task: Task) => void;
  onToast: (message: string) => void;
  onGoalsChange: (goals: Goal[]) => void;
  onBack: () => void;
}

const statusLabels: Record<GoalStatus, string> = {
  active: "进行中",
  completed: "已完成",
  abandoned: "已放弃",
};

export function GoalsView({ api, onOpenTask, onToast, onGoalsChange, onBack }: GoalsViewProps): ReactElement {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [progress, setProgress] = useState<Record<string, GoalProgress>>({});
  const [selected, setSelected] = useState<Goal | null>(null);
  const [goalTasks, setGoalTasks] = useState<Task[]>([]);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const items = await api.getGoals();
      const values = await Promise.all(items.map(async (goal) => [goal.id, await api.getGoalProgress(goal.id)] as const));
      setGoals(items);
      setProgress(Object.fromEntries(values));
      onGoalsChange(items);
    } catch {
      setError("目标暂时无法读取。");
    } finally {
      setLoading(false);
    }
  }, [api, onGoalsChange]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openGoal(goal: Goal): Promise<void> {
    setSelected(goal);
    try {
      setGoalTasks(await api.getGoalTasks(goal.id));
    } catch {
      setGoalTasks([]);
      onToast("目标任务暂时无法读取");
    }
  }

  async function updateStatus(goal: Goal, status: GoalStatus): Promise<void> {
    const previous = goals;
    const optimistic = { ...goal, status };
    setGoals((items) => items.map((item) => item.id === goal.id ? optimistic : item));
    try {
      const saved = await api.updateGoal(goal.id, { status });
      setGoals((items) => items.map((item) => item.id === goal.id ? saved : item));
      setSelected((current) => current?.id === saved.id ? saved : current);
      onToast("目标状态已保存");
    } catch {
      setGoals(previous);
      onToast("保存失败，已恢复原状态");
    }
  }

  async function editGoal(goal: Goal, patch: Partial<Pick<Goal, "title" | "description" | "timeframe">>): Promise<void> {
    const previous = goals;
    setGoals((items) => items.map((item) => item.id === goal.id ? { ...item, ...patch } : item));
    try {
      const saved = await api.updateGoal(goal.id, patch);
      setGoals((items) => items.map((item) => item.id === goal.id ? saved : item));
      setSelected(saved);
      onToast("目标已保存");
    } catch {
      setGoals(previous);
      onToast("保存失败，已恢复原内容");
    }
  }

  async function remove(goal: Goal): Promise<void> {
    const previous = goals;
    setGoals((items) => items.filter((item) => item.id !== goal.id));
    setSelected(null);
    try {
      await api.deleteGoal(goal.id);
      onToast("目标已归档，关联任务保留");
    } catch {
      setGoals(previous);
      onToast("归档失败，已恢复目标");
    }
  }

  return (
    <section className="board v02-page goals-page" aria-labelledby="goals-title">
      <header className="v02-page-header">
        <div><button type="button" className="review-back" onClick={onBack}>← 返回设置</button><p className="eyebrow">任务为什么值得做</p><h1 id="goals-title">目标</h1></div>
        <button className="button button-primary" onClick={() => setCreating(true)}>+新建目标</button>
      </header>
      {error && <div className="inline-error"><span>{error}</span><button onClick={() => void load()}>重试</button></div>}
      {loading ? <div className="v02-loading">正在整理目标…</div> : goals.length === 0 ? (
        <div className="v02-empty"><span>◎</span><h3>先写下一个方向</h3><p>目标不需要完美，只要能帮你判断任务是否值得做。</p></div>
      ) : (
        <div className="goal-grid">
          {goals.map((goal) => {
            const value = progress[goal.id] ?? { completed: 0, total: 0, percent: 0 };
            return (
              <article className={`goal-card status-${goal.status}`} key={goal.id}>
                <header><span>{statusLabels[goal.status]}</span><small>{goal.timeframe || "未设时间范围"}</small></header>
                <button className="goal-card-title" onClick={() => void openGoal(goal)}><h2>{goal.title}</h2><p>{goal.description || "还没有补充说明"}</p></button>
                <div className="progress-track"><i style={{ width: `${value.percent}%` }} /></div>
                <footer><strong>{value.percent}%</strong><span>{value.completed} / {value.total} 项已完成</span><button onClick={() => void openGoal(goal)}>查看 →</button></footer>
              </article>
            );
          })}
        </div>
      )}
      {creating && <GoalForm api={api} onClose={() => setCreating(false)} onCreated={() => void load()} onToast={onToast} />}
      {selected && (
        <GoalPanel
          goal={selected}
          tasks={goalTasks}
          progress={progress[selected.id]}
          onClose={() => setSelected(null)}
          onOpenTask={onOpenTask}
          onStatus={updateStatus}
          onEdit={editGoal}
          onDelete={remove}
        />
      )}
    </section>
  );
}

function GoalForm({
  api,
  onClose,
  onCreated,
  onToast,
}: {
  api: LifeOSApi;
  onClose: () => void;
  onCreated: () => void;
  onToast: (message: string) => void;
}): ReactElement {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await api.createGoal({
        title: title.trim(),
        description: description.trim() || null,
        timeframe: timeframe.trim() || null,
      });
      onToast("目标已创建");
      onCreated();
      onClose();
    } catch (reason) {
      onToast(reason instanceof Error ? reason.message : "目标创建失败");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="v02-modal-layer">
      <button className="v02-modal-backdrop" onClick={onClose} aria-label="关闭" />
      <form className="v02-modal" onSubmit={submit}>
        <header><div><p className="eyebrow">定义方向</p><h2>新建目标</h2></div><button type="button" className="icon-button" onClick={onClose}>×</button></header>
        <label className="field"><span>目标名称</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="field"><span>描述</span><textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <label className="field"><span>时间范围</span><input placeholder="例如：2026 Q3、未来 8 周" value={timeframe} onChange={(event) => setTimeframe(event.target.value)} /></label>
        <footer><button type="button" className="button button-secondary" onClick={onClose}>取消</button><button className="button button-primary" disabled={!title.trim() || saving}>{saving ? "创建中…" : "创建目标"}</button></footer>
      </form>
    </div>
  );
}

function GoalPanel({
  goal,
  tasks,
  progress,
  onClose,
  onOpenTask,
  onStatus,
  onEdit,
  onDelete,
}: {
  goal: Goal;
  tasks: Task[];
  progress: GoalProgress | undefined;
  onClose: () => void;
  onOpenTask: (task: Task) => void;
  onStatus: (goal: Goal, status: GoalStatus) => Promise<void>;
  onEdit: (goal: Goal, patch: Partial<Pick<Goal, "title" | "description" | "timeframe">>) => Promise<void>;
  onDelete: (goal: Goal) => Promise<void>;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(goal.title);
  const [description, setDescription] = useState(goal.description ?? "");
  const [timeframe, setTimeframe] = useState(goal.timeframe ?? "");
  async function save(): Promise<void> {
    if (!title.trim()) return;
    await onEdit(goal, { title: title.trim(), description: description.trim() || null, timeframe: timeframe.trim() || null });
    setEditing(false);
  }
  return (
    <div className="v02-modal-layer">
      <button className="v02-modal-backdrop" onClick={onClose} aria-label="关闭" />
      <aside className="v02-panel">
        <header><div><p className="eyebrow">{goal.timeframe || "长期目标"}</p><h2>{goal.title}</h2></div><button className="icon-button" onClick={onClose}>×</button></header>
        {editing ? <div className="goal-edit"><input value={title} onChange={(event) => setTitle(event.target.value)} /><textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /><input value={timeframe} placeholder="时间范围" onChange={(event) => setTimeframe(event.target.value)} /><div><button className="button button-secondary" onClick={() => setEditing(false)}>取消</button><button className="button button-primary" onClick={() => void save()}>保存</button></div></div> : <div className="goal-description"><p>{goal.description || "暂无描述"}</p><button className="text-button" onClick={() => setEditing(true)}>编辑目标</button></div>}
        <div className="goal-panel-progress"><strong>{progress?.percent ?? 0}%</strong><span>{progress?.completed ?? 0} / {progress?.total ?? 0} 任务完成</span><div className="progress-track"><i style={{ width: `${progress?.percent ?? 0}%` }} /></div></div>
        <div className="goal-status-actions">
          {(["active", "completed", "abandoned"] as GoalStatus[]).map((status) => <button className={goal.status === status ? "active" : ""} key={status} onClick={() => void onStatus(goal, status)}>{statusLabels[status]}</button>)}
        </div>
        <section className="goal-task-list"><h3>关联任务</h3>{tasks.length === 0 ? <p className="muted">还没有任务关联到这个目标。</p> : tasks.map((task) => <button key={task.id} onClick={() => onOpenTask(task)}><span>{task.status === "completed" ? "✓" : "○"}</span><strong>{task.title}</strong><small>{task.score ?? "—"}</small></button>)}</section>
        <footer className="goal-panel-footer"><button className="text-button danger" onClick={() => void onDelete(goal)}>归档目标</button></footer>
      </aside>
    </div>
  );
}
