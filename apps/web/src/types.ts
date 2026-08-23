export type Temperature = "hot" | "warm" | "cold" | "inspiration";
export type TaskStatus =
  | "todo"
  | "in_progress"
  | "completed"
  | "archived"
  | "abandoned";
export type Hardness = "soft" | "hard";

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
  tags: string[];
  score: number | null;
  rank: number;
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
    | "tags"
  >
>;

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
