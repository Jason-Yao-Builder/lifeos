import type {
  TaskImageMetadata,
  TaskImageMimeType,
  TaskScoreDimensions,
} from '@lifeos/contracts';
import type {
  actorTypes,
  aiRunStatuses,
  cardStatuses,
  cardTypes,
  dependencyTypes,
  goalStatuses,
  messageRoles,
  reviewTypes,
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
export type GoalStatus = (typeof goalStatuses)[number];
export type DependencyType = (typeof dependencyTypes)[number];
export type ReviewType = (typeof reviewTypes)[number];

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
  groupId: string | null;
  parentTaskId: string | null;
  goalId: string | null;
  repeatTemplateId: string | null;
  plannedStartTime: string | null;
  plannedEndTime: string | null;
  carryOverFrom: string | null;
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

export interface CreateTaskImageInput {
  id?: string;
  tenantId?: string;
  taskId: string;
  fileName: string;
  mimeType: TaskImageMimeType;
  data: Buffer;
}

export interface TaskImageContentRecord {
  metadata: TaskImageMetadata;
  data: Buffer;
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
  groupId?: string | null;
  parentTaskId?: string | null;
  goalId?: string | null;
  repeatTemplateId?: string | null;
  plannedStartTime?: string | null;
  plannedEndTime?: string | null;
  carryOverFrom?: string | null;
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
    | 'groupId'
    | 'parentTaskId'
    | 'goalId'
    | 'repeatTemplateId'
    | 'plannedStartTime'
    | 'plannedEndTime'
    | 'carryOverFrom'
    | 'tags'
    | 'scoreDimensions'
    | 'score'
    | 'rank'
  >
>;

export interface TaskGroupRecord {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskGroupInput {
  id?: string;
  workspaceId?: string;
  name: string;
  color: string;
}

export type UpdateTaskGroupPatch = Partial<Pick<TaskGroupRecord, 'name' | 'color'>>;

export interface TaskListFilters {
  tenantId?: string;
  temperature?: Temperature;
  status?: TaskStatus;
  tag?: string;
  query?: string;
  deadlineFrom?: string;
  deadlineTo?: string;
  goalId?: string;
  parentTaskId?: string | null;
  repeatTemplateId?: string;
  limit?: number;
  offset?: number;
}

export interface DateRangeFilters {
  tenantId?: string;
  start: string;
  end: string;
  goalId?: string;
}

export interface TaskProgress {
  completed: number;
  total: number;
  percent: number;
}

export interface GoalRecord {
  id: string;
  workspaceId: string;
  ownerId: string;
  title: string;
  description: string | null;
  timeframe: string | null;
  status: GoalStatus;
  rank: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  deletedAt: string | null;
}

export interface CreateGoalInput {
  id?: string;
  tenantId?: string;
  ownerId?: string;
  title: string;
  description?: string | null;
  timeframe?: string | null;
  status?: GoalStatus;
  rank?: number;
}

export type UpdateGoalPatch = Partial<
  Pick<CreateGoalInput, 'title' | 'description' | 'timeframe' | 'status' | 'rank'>
>;

export interface GoalListFilters {
  tenantId?: string;
  status?: GoalStatus;
  limit?: number;
  offset?: number;
}

export interface GoalProgress extends TaskProgress {
  byTemperature: Record<Temperature, number>;
}

export interface TaskDependencyRecord {
  id: string;
  workspaceId: string;
  predecessorId: string;
  successorId: string;
  type: DependencyType;
  createdAt: string;
}

export interface CreateTaskDependencyInput {
  id?: string;
  tenantId?: string;
  predecessorId: string;
  successorId: string;
  type?: DependencyType;
}

export interface TaskDependencies {
  predecessors: TaskDependencyRecord[];
  successors: TaskDependencyRecord[];
  isBlocked: boolean;
}

export interface RepeatTemplateRecord {
  id: string;
  workspaceId: string;
  ownerId: string;
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
  deletedAt: string | null;
}

export interface CreateRepeatTemplateInput {
  id?: string;
  tenantId?: string;
  ownerId?: string;
  title: string;
  description?: string | null;
  temperature?: Temperature;
  tags?: string[];
  estimatedMinutes?: number | null;
  goalId?: string | null;
  cronExpr: string;
  timezone?: string;
  horizonDays?: number;
  enabled?: boolean;
}

export type UpdateRepeatTemplatePatch = Partial<
  Pick<
    CreateRepeatTemplateInput,
    | 'title'
    | 'description'
    | 'temperature'
    | 'tags'
    | 'estimatedMinutes'
    | 'goalId'
    | 'cronExpr'
    | 'timezone'
    | 'horizonDays'
    | 'enabled'
  >
>;

export interface RepeatTemplateListFilters {
  tenantId?: string;
  enabled?: boolean;
  goalId?: string;
  limit?: number;
}

export interface RepeatGenerationOptions {
  throughDate?: string;
}

export interface RepeatGenerationResult {
  templateId: string;
  dates: string[];
  tasks: TaskRecord[];
  lastGenerated: string | null;
}

export interface ReviewCardRecord {
  id: string;
  workspaceId: string;
  ownerId: string;
  type: ReviewType;
  periodStart: string;
  periodEnd: string;
  content: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReviewCardInput {
  id?: string;
  tenantId?: string;
  ownerId?: string;
  type: ReviewType;
  periodStart: string;
  periodEnd: string;
  content: unknown;
}

export interface ReviewCardListFilters {
  tenantId?: string;
  type?: ReviewType;
  periodFrom?: string;
  periodTo?: string;
  limit?: number;
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
