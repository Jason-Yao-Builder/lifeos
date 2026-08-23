import {
  type AnySQLiteColumn,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const temperatures = ['inspiration', 'cold', 'warm', 'hot'] as const;
export const taskStatuses = [
  'todo',
  'in_progress',
  'completed',
  'archived',
  'abandoned',
] as const;
export const actorTypes = ['human', 'ai', 'rule', 'system'] as const;
export const cardTypes = ['action', 'observation', 'generation'] as const;
export const cardStatuses = [
  'pending',
  'accepted',
  'rejected',
  'dismissed',
  'discussing',
  'resolved',
  'archived',
] as const;
export const messageRoles = ['user', 'assistant', 'system'] as const;
export const aiRunStatuses = ['pending', 'running', 'completed', 'failed'] as const;

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Shanghai'),
  createdAt: text('created_at').notNull(),
});

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('users_workspace_idx').on(table.workspaceId)],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description'),
    temperature: text('temperature', { enum: temperatures }).notNull().default('inspiration'),
    status: text('status', { enum: taskStatuses }).notNull().default('todo'),
    deadlineAt: text('deadline_at'),
    plannedDate: text('planned_date'),
    startsAt: text('starts_at'),
    endsAt: text('ends_at'),
    estimatedMinutes: integer('estimated_minutes'),
    actualMinutes: integer('actual_minutes').notNull().default(0),
    parentTaskId: text('parent_task_id').references((): AnySQLiteColumn => tasks.id, {
      onDelete: 'set null',
    }),
    tagsJson: text('tags_json').notNull().default('[]'),
    scoreDimensionsJson: text('score_dimensions_json'),
    score: real('score'),
    rank: real('rank').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    completedAt: text('completed_at'),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    index('tasks_workspace_rank_idx').on(table.workspaceId, table.rank),
    index('tasks_workspace_temperature_idx').on(table.workspaceId, table.temperature),
    index('tasks_workspace_status_idx').on(table.workspaceId, table.status),
    index('tasks_deadline_idx').on(table.deadlineAt),
  ],
);

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    type: text('type').notNull(),
    actorType: text('actor_type', { enum: actorTypes }).notNull(),
    actorId: text('actor_id'),
    beforeJson: text('before_json'),
    afterJson: text('after_json'),
    metadataJson: text('metadata_json'),
    correlationId: text('correlation_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('events_aggregate_idx').on(table.workspaceId, table.aggregateType, table.aggregateId),
    index('events_created_idx').on(table.workspaceId, table.createdAt),
  ],
);

export const aiRuns = sqliteTable(
  'ai_runs',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    status: text('status', { enum: aiRunStatuses }).notNull().default('pending'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputJson: text('input_json'),
    outputJson: text('output_json'),
    explanation: text('explanation'),
    error: text('error'),
    idempotencyKey: text('idempotency_key'),
    createdAt: text('created_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [
    uniqueIndex('ai_runs_idempotency_idx').on(table.workspaceId, table.idempotencyKey),
    index('ai_runs_workspace_created_idx').on(table.workspaceId, table.createdAt),
  ],
);

export const cards = sqliteTable(
  'cards',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    aiRunId: text('ai_run_id').references(() => aiRuns.id, { onDelete: 'set null' }),
    type: text('type', { enum: cardTypes }).notNull(),
    status: text('status', { enum: cardStatuses }).notNull().default('pending'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    proposalJson: text('proposal_json'),
    decisionJson: text('decision_json'),
    hasDiscussion: integer('has_discussion', { mode: 'boolean' }).notNull().default(false),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    decidedAt: text('decided_at'),
  },
  (table) => [
    index('cards_workspace_status_idx').on(table.workspaceId, table.status),
    index('cards_task_idx').on(table.taskId),
  ],
);

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    cardId: text('card_id').references(() => cards.id, { onDelete: 'set null' }),
    title: text('title'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('conversations_workspace_idx').on(table.workspaceId, table.updatedAt)],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: messageRoles }).notNull(),
    content: text('content').notNull(),
    metadataJson: text('metadata_json'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('messages_conversation_idx').on(table.conversationId, table.createdAt)],
);

export const rules = sqliteTable(
  'rules',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    triggerJson: text('trigger_json').notNull(),
    conditionJson: text('condition_json').notNull(),
    actionJson: text('action_json').notNull(),
    configJson: text('config_json').notNull().default('{}'),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('rules_workspace_enabled_idx').on(table.workspaceId, table.enabled)],
);

export const schema = {
  workspaces,
  users,
  tasks,
  events,
  aiRuns,
  cards,
  conversations,
  messages,
  rules,
};
