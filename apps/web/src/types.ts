export type Temperature = "hot" | "warm" | "cold" | "inspiration";
export type TaskStatus =
  | "todo"
  | "in_progress"
  | "completed"
  | "archived"
  | "abandoned";
export type Hardness = "soft" | "hard";

export interface TaskScoreDimensions {
  impact: number;
  urgency: number;
  alignment: number;
  effort: number;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  actor: "user" | "ai" | "rule";
  summary: string;
  createdAt: string;
}

export interface TaskImage {
  id: string;
  taskId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface UploadTaskImageInput {
  fileName: string;
  mimeType: string;
  dataBase64: string;
}

export interface Task {
  id: string;
  version: number;
  title: string;
  description: string | null;
  temperature: Temperature;
  status: TaskStatus;
  hardness: Hardness;
  deadline: string | null;
  plannedDate: string | null;
  startAt?: string | null;
  endAt?: string | null;
  parentTaskId?: string | null;
  goalId?: string | null;
  repeatTemplateId?: string | null;
  plannedStartTime?: string | null;
  plannedEndTime?: string | null;
  carryOverFrom?: string | null;
  isBlocked?: boolean;
  progress?: number;
  tags: string[];
  scoreDimensions?: TaskScoreDimensions | null;
  score: number | null;
  rank: number;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTask {
  title: string;
  description?: string;
  temperature: Temperature;
  status?: TaskStatus;
  deadline?: string | null;
  plannedDate?: string | null;
  tags?: string[];
  scoreDimensions?: TaskScoreDimensions | null;
}

export type UpdateTask = Partial<
  Pick<
    Task,
    | "title"
    | "description"
    | "temperature"
    | "status"
    | "deadline"
    | "plannedDate"
    | "startAt"
    | "endAt"
    | "parentTaskId"
    | "goalId"
    | "repeatTemplateId"
    | "tags"
    | "scoreDimensions"
  >
>;

export type GoalStatus = "active" | "completed" | "abandoned";

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  timeframe: string | null;
  status: GoalStatus;
  rank: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  deletedAt?: string | null;
}

export interface GoalProgress {
  completed: number;
  total: number;
  percent: number;
  byTemperature?: Partial<Record<Temperature, number>>;
}

export interface TaskDependency {
  id: string;
  predecessorId: string;
  successorId: string;
  type: "finish_to_start";
  createdAt: string;
}

export interface TaskProgress {
  completed: number;
  total: number;
  percent: number;
}

export interface RepeatTemplate {
  id: string;
  title: string;
  description: string | null;
  temperature: Temperature;
  tags: string[];
  estimatedMinutes: number | null;
  goalId: string | null;
  cronExpr: string;
  timezone: string;
  horizonDays: number;
  enabled: boolean;
  lastGenerated: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CalendarMode = "month" | "week" | "day";

export interface CalendarDay {
  tasks: Task[];
  deadlineTasks: Task[];
  repeatTasks: Task[];
}

export interface CalendarData {
  days: Record<string, CalendarDay>;
}

export interface GanttTask extends Task {
  progress: number;
  isBlocked: boolean;
}

export interface GanttData {
  tasks: GanttTask[];
  dependencies: TaskDependency[];
  criticalPath: string[];
}

export type ReviewType = "daily_plan" | "daily_review" | "weekly_review" | "monthly_review";

export interface ReviewCard {
  id: string;
  type: ReviewType;
  periodStart: string;
  periodEnd: string;
  content: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MorningPlanningData {
  unfinished: Task[];
  planned: Task[];
  deadlineToday: Task[];
}

export type CarryoverAction = "carry_today" | "reschedule" | "cool_down" | "abandon";

export interface CarryoverDecision {
  taskId: string;
  action: CarryoverAction;
  targetDate?: string;
}

export interface DailyReviewContent {
  plannedTasks: Array<{ taskId: string; title: string; completed: boolean }>;
  unplannedCompleted: Array<{ taskId: string; title: string }>;
  completionRate: number;
  incompleteReasons: Array<{ taskId: string; reason: string }>;
  totalFocusMinutes: number;
}

export type CardType = "action" | "observation" | "generation";
export type CardStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "discussing"
  | "dismissed"
  | "resolved"
  | "archived";

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AiCard {
  id: string;
  version?: number;
  type: CardType;
  status: CardStatus;
  title: string;
  body: string;
  suggestedAction?: string;
  conversationId?: string;
  hasDiscussion?: boolean;
  messages?: ConversationMessage[];
  createdAt: string;
}

export interface Rule {
  id: string;
  version: number;
  name: string;
  description: string;
  enabled: boolean;
  parameters: Record<string, number | string | boolean>;
  lastTriggeredAt: string | null;
}

export interface DashboardStats {
  total: number;
  hot: number;
  completed: number;
  dueSoon: number;
}

export interface TaskListResponse {
  items: Task[];
}

export interface EventListResponse {
  items: TaskEvent[];
}

export interface CardListResponse {
  items: AiCard[];
}

export interface RuleListResponse {
  items: Rule[];
}
