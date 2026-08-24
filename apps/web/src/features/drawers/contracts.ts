import type { LifeOSApi } from "../../api";
import type {
  AiCard,
  Goal,
  Rule,
  Task,
  TaskGroup,
  UpdateTask,
} from "../../types";

export type TaskDrawerTab = "details" | "structure" | "history";

export interface TaskDrawerProps {
  task: Task | null;
  api: LifeOSApi;
  onClose: () => void;
  onSave: (task: Task, patch: UpdateTask) => Promise<void>;
  onOpenTask: (taskId: string) => void;
  allTasks: Task[];
  goals: Goal[];
  taskGroups: TaskGroup[];
  onCreateTaskGroup: (input: Pick<TaskGroup, "name" | "color">) => Promise<TaskGroup>;
  onStructureChanged: () => Promise<void>;
}

export interface TaskStructureProps {
  task: Task;
  api: LifeOSApi;
  allTasks: Task[];
  onOpenTask: (taskId: string, targetTab: Extract<TaskDrawerTab, "details" | "structure">) => void;
  onChanged: () => Promise<void>;
}

export interface AiDrawerProps {
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

export interface RulesDrawerProps {
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
