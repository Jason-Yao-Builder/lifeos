import type { TaskScoreDimensions } from '@lifeos/contracts';
import type {
  actorTypes,
  aiRunStatuses,
  cardStatuses,
  cardTypes,
  messageRoles,
  taskStatuses,
  temperatures,
} from './schema.js';

export const DEFAULT_WORKSPACE_ID = 'local-workspace';
export const DEFAULT_TENANT_ID = DEFAULT_WORKSPACE_ID;
export const DEFAULT_USER_ID = 'local-user';

export type Temperature = (typeof temperatures)[number];
export type TaskStatus = (typeof taskStatuses)[number];
export type ActorType = (typeof actorTypes)[number];
export type CardType = (typeof cardTypes)[number];
export type CardStatus = (typeof cardStatuses)[number];
export type MessageRole = (typeof messageRoles)[number];
export type AiRunStatus = (typeof aiRunStatuses)[number];

export interface ActorInput {
  type: ActorType;
  id?: string;
  correlationId?: string;
}

export interface TaskRecord {
  id: string;
  tenantId: string;
  ownerId: string;
  title: string;
  description: string | null;
  temperature: Temperature;
  status: TaskStatus;
  deadline: string | null;
  plannedDate: string | null;
  startAt: string | null;
  endAt: string | null;
  estimatedMinutes: number | null;
  actualMinutes: number;
  tags: string[];
  scoreDimensions: TaskScoreDimensions | null;
  score: number | null;
  rank: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  deletedAt: string | null;
}

export interface CreateTaskInput {
  id?: string;
  tenantId?: string;
  ownerId?: string;
  title: string;
  description?: string | null;
  temperature?: Temperature;
  status?: TaskStatus;
  deadline?: string | null;
  plannedDate?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  estimatedMinutes?: number | null;
  actualMinutes?: number | null;
  parentTaskId?: string | null;
  tags?: string[];
  scoreDimensions?: TaskScoreDimensions | null;
  score?: number | null;
  rank?: number;
}

export type UpdateTaskPatch = Partial<
  Pick<
    CreateTaskInput,
    | 'title'
    | 'description'
    | 'temperature'
    | 'status'
    | 'deadline'
    | 'plannedDate'
    | 'startAt'
    | 'endAt'
    | 'estimatedMinutes'
    | 'actualMinutes'
    | 'parentTaskId'
    | 'tags'
    | 'scoreDimensions'
    | 'score'
    | 'rank'
  >
>;

export interface TaskListFilters {
  tenantId?: string;
  temperature?: Temperature;
  status?: TaskStatus;
  tag?: string;
  query?: string;
  deadlineFrom?: string;
  deadlineTo?: string;
  limit?: number;
  offset?: number;
}

export interface EventRecord {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  type: string;
  actorType: ActorType;
  actorId: string | null;
  before: unknown | null;
  after: unknown | null;
  metadata: unknown | null;
  correlationId: string | null;
  createdAt: string;
}

export interface CardRecord {
  id: string;
  tenantId: string;
  targetTaskId: string | null;
  aiRunId: string | null;
  type: CardType;
  status: CardStatus;
  title: string;
  body: string;
  hasDiscussion: boolean;
  proposal: unknown | null;
  decision: unknown | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface CreateCardInput {
  id?: string;
  tenantId?: string;
  targetTaskId?: string | null;
  aiRunId?: string | null;
  type: CardType;
  title: string;
  body: string;
  proposal?: unknown | null;
}

export interface CardListFilters {
  tenantId?: string;
  status?: CardStatus;
  type?: CardType;
  targetTaskId?: string;
  limit?: number;
}

export interface ConversationRecord {
  id: string;
  tenantId: string;
  cardId: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  metadata: unknown | null;
  createdAt: string;
}

export interface RuleRecord {
  id: string;
  tenantId: string;
  name: string;
  enabled: boolean;
  trigger: unknown;
  condition: unknown;
  action: unknown;
  config: unknown;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRuleInput {
  id?: string;
  tenantId?: string;
  name: string;
  enabled?: boolean;
  trigger: unknown;
  condition: unknown;
  action: unknown;
  config?: unknown;
}

export interface UpdateRulePatch {
  name?: string;
  enabled?: boolean;
  trigger?: unknown;
  condition?: unknown;
  action?: unknown;
  config?: unknown;
}

export interface AiRunRecord {
  id: string;
  tenantId: string;
  purpose: string;
  status: AiRunStatus;
  provider: string;
  model: string;
  input: unknown | null;
  output: unknown | null;
  explanation: string | null;
  error: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface CreateAiRunInput {
  id?: string;
  tenantId?: string;
  purpose: string;
  provider: string;
  model: string;
  input?: unknown;
  idempotencyKey?: string | null;
}

export interface DebugStats {
  tasks: {
    total: number;
    byTemperature: Record<string, number>;
    byStatus: Record<string, number>;
  };
  pendingCards: number;
  enabledRules: number;
  failedAiRuns: number;
}
