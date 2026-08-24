import type {
  CardStatus,
  CreateTaskInput,
  GoalProgress,
  GoalRecord,
  RepeatTemplateRecord,
  RuleProposal,
  TaskDependencyRecord,
  TaskImageMetadata,
  TaskImageMimeType,
  TaskProgress,
  TaskRecord,
  TaskScoreDimensions,
  TaskStatus,
  Temperature,
} from '@lifeos/contracts';

export type Awaitable<T> = T | Promise<T>;

export interface ActorInput {
  type: 'human' | 'ai' | 'rule' | 'system';
  id?: string;
  correlationId?: string;
}

export interface EventRecord {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  type: string;
  actorType: ActorInput['type'];
  actorId: string | null;
  before: unknown | null;
  after: unknown | null;
  metadata: unknown | null;
  correlationId: string | null;
  createdAt: string;
}

export interface StoredCard {
  id: string;
  tenantId: string;
  targetTaskId: string | null;
  aiRunId: string | null;
  type: 'action' | 'observation' | 'generation';
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
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: unknown | null;
  createdAt: string;
}

export interface AiRunRecord {
  id: string;
  tenantId: string;
  purpose: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
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

export interface TaskFilters {
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

export type StoreCreateTaskInput = Omit<CreateTaskInput, 'status'> & {
  status?: TaskStatus;
  tenantId?: string;
  ownerId?: string;
  score?: number | null;
};

export interface StoreTaskPatch {
  title?: string;
  description?: string | null;
  temperature?: Temperature;
  status?: TaskStatus;
  tags?: string[];
  deadline?: string | null;
  plannedDate?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  estimatedMinutes?: number | null;
  actualMinutes?: number;
  scoreDimensions?: TaskScoreDimensions | null;
  score?: number | null;
  rank?: number;
  parentTaskId?: string | null;
  goalId?: string | null;
  repeatTemplateId?: string | null;
  plannedStartTime?: string | null;
  plannedEndTime?: string | null;
  carryOverFrom?: string | null;
}

export interface RepeatGenerationResult {
  templateId: string;
  dates: string[];
  tasks: TaskRecord[];
  lastGenerated: string | null;
}

export interface StoredTaskImageContent {
  metadata: TaskImageMetadata;
  data: Buffer;
}

export interface StoredReviewCard {
  id: string;
  workspaceId: string;
  ownerId: string;
  type: 'daily_plan' | 'daily_review' | 'weekly_review' | 'monthly_review';
  periodStart: string;
  periodEnd: string;
  content: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface ApiStore {
  tasks: {
    list(filters?: TaskFilters): TaskRecord[];
    get(tenantId: string, id: string): TaskRecord | null;
    create(input: StoreCreateTaskInput, actor?: ActorInput): TaskRecord;
    update(
      tenantId: string,
      id: string,
      expectedVersion: number,
      patch: StoreTaskPatch,
      actor?: ActorInput,
    ): TaskRecord;
    reorder(tenantId: string, orderedIds: string[], actor?: ActorInput): TaskRecord[];
    reorderSubtasks(
      tenantId: string,
      parentId: string,
      orderedIds: string[],
      actor?: ActorInput,
    ): TaskRecord[];
    events(tenantId: string, taskId: string): EventRecord[];
    listSubtasks(tenantId: string, parentId: string): TaskRecord[];
    progress(tenantId: string, parentId: string): TaskProgress;
    listCalendar(filters: {
      tenantId?: string;
      start: string;
      end: string;
      goalId?: string;
    }): TaskRecord[];
    listGantt(filters: {
      tenantId?: string;
      start: string;
      end: string;
      goalId?: string;
    }): TaskRecord[];
    softDelete: (
      tenantId: string,
      id: string,
      expectedVersion: number,
      actor?: ActorInput,
    ) => void;
  };
  taskImages: {
    list(tenantId: string, taskId: string): TaskImageMetadata[];
    getContent(
      tenantId: string,
      taskId: string,
      imageId: string,
    ): StoredTaskImageContent | null;
    create(
      input: {
        id?: string;
        tenantId?: string;
        taskId: string;
        fileName: string;
        mimeType: TaskImageMimeType;
        data: Buffer;
      },
      actor?: ActorInput,
    ): TaskImageMetadata;
    remove(
      tenantId: string,
      taskId: string,
      imageId: string,
      actor?: ActorInput,
    ): TaskImageMetadata;
  };
  goals: {
    list(filters?: { tenantId?: string; status?: GoalRecord['status'] }): GoalRecord[];
    get(tenantId: string, id: string): GoalRecord | null;
    create(
      input: {
        tenantId?: string;
        ownerId?: string;
        title: string;
        description?: string | null;
        timeframe?: string | null;
        status?: GoalRecord['status'];
        rank?: number;
      },
      actor?: ActorInput,
    ): GoalRecord;
    update(
      tenantId: string,
      id: string,
      patch: Partial<Pick<GoalRecord, 'title' | 'description' | 'timeframe' | 'status' | 'rank'>>,
      actor?: ActorInput,
    ): GoalRecord;
    softDelete(tenantId: string, id: string, actor?: ActorInput): void;
    tasks(tenantId: string, id: string): TaskRecord[];
    progress(tenantId: string, id: string): GoalProgress;
  };
  dependencies: {
    listForTask(tenantId: string, taskId: string): {
      predecessors: TaskDependencyRecord[];
      successors: TaskDependencyRecord[];
    };
    create(
      input: {
        tenantId?: string;
        predecessorId: string;
        successorId: string;
        type?: TaskDependencyRecord['type'];
      },
      actor?: ActorInput,
    ): TaskDependencyRecord;
    remove(tenantId: string, dependencyId: string, actor?: ActorInput): void;
    isBlocked(tenantId: string, taskId: string): boolean;
    criticalPath(tenantId: string, taskIds?: string[]): string[];
  };
  repeatTemplates: {
    list(filters?: { tenantId?: string; enabled?: boolean }): RepeatTemplateRecord[];
    get(tenantId: string, id: string): RepeatTemplateRecord | null;
    create(
      input: {
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
      },
      actor?: ActorInput,
    ): RepeatTemplateRecord;
    update(
      tenantId: string,
      id: string,
      patch: Partial<
        Pick<
          RepeatTemplateRecord,
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
      >,
      actor?: ActorInput,
    ): RepeatTemplateRecord;
    softDelete(tenantId: string, id: string, actor?: ActorInput): void;
    generate(
      tenantId: string,
      id: string,
      options?: { throughDate?: string },
      actor?: ActorInput,
    ): RepeatGenerationResult;
    generateAll(
      tenantId?: string,
      options?: { throughDate?: string },
      actor?: ActorInput,
    ): RepeatGenerationResult[];
  };
  reviews: {
    list(filters?: {
      tenantId?: string;
      type?: StoredReviewCard['type'];
      periodFrom?: string;
      periodTo?: string;
    }): StoredReviewCard[];
    get(tenantId: string, id: string): StoredReviewCard | null;
    create(
      input: {
        tenantId?: string;
        ownerId?: string;
        type: StoredReviewCard['type'];
        periodStart: string;
        periodEnd: string;
        content: unknown;
      },
      actor?: ActorInput,
    ): StoredReviewCard;
    update(
      tenantId: string,
      id: string,
      content: unknown,
      actor?: ActorInput,
    ): StoredReviewCard;
  };
  cards: {
    list(filters?: {
      tenantId?: string;
      status?: CardStatus;
      type?: StoredCard['type'];
      targetTaskId?: string;
      limit?: number;
    }): StoredCard[];
    get(tenantId: string, id: string): StoredCard | null;
    create(
      input: Pick<StoredCard, 'type' | 'title' | 'body'> &
        Partial<Pick<StoredCard, 'tenantId' | 'targetTaskId' | 'aiRunId' | 'proposal'>>,
      actor?: ActorInput,
    ): StoredCard;
    decide(
      tenantId: string,
      id: string,
      expectedVersion: number,
      status: CardStatus,
      decision?: unknown,
      actor?: ActorInput,
    ): StoredCard;
  };
  conversations: {
    list(tenantId?: string, limit?: number): ConversationRecord[];
    get(tenantId: string, id: string): ConversationRecord | null;
    create(
      input: { id?: string; tenantId?: string; cardId?: string | null; title?: string | null },
      actor?: ActorInput,
    ): ConversationRecord;
    listMessages(conversationId: string): MessageRecord[];
    addMessage(
      input: {
        conversationId: string;
        role: MessageRecord['role'];
        content: string;
        metadata?: unknown;
      },
      actor?: ActorInput,
    ): MessageRecord;
  };
  rules: {
    list(tenantId?: string, enabled?: boolean): RuleRecord[];
    update(
      tenantId: string,
      id: string,
      expectedVersion: number,
      patch: Partial<Pick<RuleRecord, 'name' | 'enabled' | 'trigger' | 'condition' | 'action' | 'config'>>,
      actor?: ActorInput,
    ): RuleRecord;
  };
  events: {
    list(tenantId?: string, limit?: number): EventRecord[];
  };
  aiRuns: {
    get(tenantId: string, id: string): AiRunRecord | null;
    findByIdempotencyKey(tenantId: string, key: string): AiRunRecord | null;
    start(input: {
      tenantId?: string;
      purpose: string;
      provider: string;
      model: string;
      input?: unknown;
      idempotencyKey?: string | null;
    }): AiRunRecord;
    retry(tenantId: string, id: string, input: unknown): AiRunRecord;
    complete(
      tenantId: string,
      id: string,
      output: unknown,
      explanation?: string,
    ): AiRunRecord;
    fail(tenantId: string, id: string, error: string): AiRunRecord;
  };
  debug?: {
    stats(tenantId?: string): {
      tasks: {
        total: number;
        byTemperature: Record<string, number>;
        byStatus: Record<string, number>;
      };
      pendingCards: number;
      enabledRules: number;
      failedAiRuns: number;
    };
    recentEvents(tenantId?: string, limit?: number): EventRecord[];
  };
  transaction<T>(callback: (store: ApiStore) => T): T;
}

export interface AiTaskScore {
  taskId: string;
  dimensions: TaskScoreDimensions;
  score: number;
  explanation: string;
}

export interface AiDailySummary {
  title: string;
  body: string;
  observations?: string[];
  focusTaskIds?: string[];
  explanation?: string;
}

export interface ApiAi {
  readonly provider: string;
  readonly model: string;
  scoreTasks(tasks: TaskRecord[]): Awaitable<AiTaskScore[]>;
  dailySummary(tasks: TaskRecord[], date: string): Awaitable<AiDailySummary>;
  reply(input: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    tasks?: TaskRecord[];
  }): Awaitable<{ content: string; explanation: string }>;
}

export interface AppDependencies {
  store: ApiStore;
  ai: ApiAi;
  tenantId?: string;
  userId?: string;
  now?: () => Date;
}

export interface RuleEvaluationResult {
  proposals: RuleProposal[];
  appliedTaskIds: string[];
  cardIds: string[];
}
