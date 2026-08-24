import type { AiCard, Goal, Rule, Task, TaskGroup } from "../types";

export interface ApplicationDataSource {
  getTasks(): Promise<Task[]>;
  getDay(date: string): Promise<Task[]>;
  getCards(): Promise<AiCard[]>;
  getRules(): Promise<Rule[]>;
  getGoals(): Promise<Goal[]>;
  getTaskGroups(): Promise<TaskGroup[]>;
}

export interface ApplicationDataSnapshot {
  tasks: Task[];
  todayTasks: Task[];
  cards: AiCard[];
  rules: Rule[];
  goals: Goal[];
  taskGroups: TaskGroup[] | null;
  aiDegraded: boolean;
  rulesError: boolean;
}

export type ApplicationDataLoadResult =
  | { status: "ready"; snapshot: ApplicationDataSnapshot }
  | { status: "error"; reason: unknown };

export function taskBelongsToDate(task: Task, date: string): boolean {
  const plannedDate = task.plannedDate?.slice(0, 10);
  const deadline = task.deadline?.slice(0, 10);
  if (task.status === "archived" || task.status === "abandoned") return false;
  if (task.status === "completed") return plannedDate === date;
  return plannedDate === date || Boolean(deadline && deadline <= date);
}

export function mergeDayTasks(
  tasks: readonly Task[],
  dayTasks: readonly Task[],
  date: string,
): Task[] {
  const completedForDate = tasks.filter(
    (task) => task.status === "completed" && task.plannedDate?.slice(0, 10) === date,
  );
  return [
    ...dayTasks,
    ...completedForDate.filter((task) => !dayTasks.some((item) => item.id === task.id)),
  ].sort((left, right) => left.rank - right.rank);
}

export async function loadApplicationData(
  api: ApplicationDataSource,
  date: string,
): Promise<ApplicationDataLoadResult> {
  const [taskResult, dayResult, cardResult, ruleResult, goalResult, groupResult] =
    await Promise.allSettled([
      api.getTasks(),
      api.getDay(date),
      api.getCards(),
      api.getRules(),
      api.getGoals(),
      api.getTaskGroups(),
    ]);
  if (taskResult.status === "rejected") {
    return { status: "error", reason: taskResult.reason };
  }
  const tasks = taskResult.value;
  const dayTasks = dayResult.status === "fulfilled"
    ? dayResult.value
    : tasks.filter((task) => taskBelongsToDate(task, date));
  return {
    status: "ready",
    snapshot: {
      tasks,
      todayTasks: mergeDayTasks(tasks, dayTasks, date),
      cards: cardResult.status === "fulfilled" ? cardResult.value : [],
      rules: ruleResult.status === "fulfilled" ? ruleResult.value : [],
      goals: goalResult.status === "fulfilled" ? goalResult.value : [],
      taskGroups: groupResult.status === "fulfilled" ? groupResult.value : null,
      aiDegraded: cardResult.status === "rejected",
      rulesError: ruleResult.status === "rejected",
    },
  };
}
