import {
  type AnySQLiteColumn,
  blob,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const temperatures = ['inspiration', 'cold', 'warm', 'hot'] as const;
export const taskStatuses = [
  'todo',
  'in_progress',
  'completed',
  'archived',
  'abandoned',
] as const;
export const taskImageMimeTypes = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
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
export const goalStatuses = ['active', 'completed', 'abandoned'] as const;
export const dependencyTypes = ['finish_to_start'] as const;
export const reviewTypes = [
  'daily_plan',
  'daily_review',
  'weekly_review',
  'monthly_review',
] as const;

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

export const goals = sqliteTable(
  'goals',
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
    timeframe: text('timeframe'),
    status: text('status', { enum: goalStatuses }).notNull().default('active'),
    rank: real('rank').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    completedAt: text('completed_at'),
    deletedAt: text('deleted_at'),
  },
  (table) => [index('goals_workspace_idx').on(table.workspaceId, table.status)],
);

export const repeatTemplates = sqliteTable(
  'repeat_templates',
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
    temperature: text('temperature', { enum: temperatures }).notNull().default('warm'),
    tagsJson: text('tags_json').notNull().default('[]'),
    estimatedMinutes: integer('estimated_minutes'),
    goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
    cronExpr: text('cron_expr').notNull(),
    timezone: text('timezone').notNull().default('Asia/Shanghai'),
    horizonDays: integer('horizon_days').notNull().default(28),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    lastGenerated: text('last_generated'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (table) => [
    index('templates_workspace_idx').on(table.workspaceId, table.enabled),
  ],
);

export const taskGroups = sqliteTable(
  'task_groups',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    color: text('color').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('task_groups_workspace_name_idx').on(table.workspaceId, table.normalizedName),
    index('task_groups_workspace_created_idx').on(table.workspaceId, table.createdAt),
    check(
      'task_groups_color_check',
      sql`length(${table.color}) = 7 and ${table.color} glob '#[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]'`,
    ),
  ],
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
    groupId: text('group_id').references(() => taskGroups.id, { onDelete: 'set null' }),
    parentTaskId: text('parent_task_id').references((): AnySQLiteColumn => tasks.id, {
      onDelete: 'set null',
    }),
    goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
    repeatTemplateId: text('repeat_template_id').references(() => repeatTemplates.id, {
      onDelete: 'set null',
    }),
    plannedStartTime: text('planned_start_time'),
    plannedEndTime: text('planned_end_time'),
    carryOverFrom: text('carry_over_from'),
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
    index('tasks_group_idx').on(table.groupId).where(sql`${table.groupId} is not null`),
    index('tasks_goal_idx').on(table.goalId).where(sql`${table.goalId} is not null`),
    index('tasks_planned_date_idx').on(table.plannedDate).where(sql`${table.plannedDate} is not null`),
    index('tasks_parent_idx').on(table.parentTaskId).where(sql`${table.parentTaskId} is not null`),
  ],
);

export const taskImages = sqliteTable(
  'task_images',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type', { enum: taskImageMimeTypes }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    data: blob('data', { mode: 'buffer' }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('task_images_task_idx').on(table.workspaceId, table.taskId, table.createdAt),
    check(
      'task_images_size_check',
      sql`${table.sizeBytes} between 1 and 5242880`,
    ),
    check('task_images_data_size_check', sql`length(${table.data}) = ${table.sizeBytes}`),
    check(
      'task_images_mime_check',
      sql`${table.mimeType} in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')`,
    ),
  ],
);

export const taskDependencies = sqliteTable(
  'task_dependencies',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    predecessorId: text('predecessor_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    successorId: text('successor_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    type: text('type', { enum: dependencyTypes }).notNull().default('finish_to_start'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('deps_pair_idx').on(table.predecessorId, table.successorId),
    index('deps_predecessor_idx').on(table.predecessorId),
    index('deps_successor_idx').on(table.successorId),
  ],
);

export const reviewCards = sqliteTable(
  'review_cards',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    type: text('type', { enum: reviewTypes }).notNull(),
    periodStart: text('period_start').notNull(),
    periodEnd: text('period_end').notNull(),
    contentJson: text('content_json').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('reviews_workspace_type_idx').on(
      table.workspaceId,
      table.type,
      table.periodStart,
    ),
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
  goals,
  repeatTemplates,
  taskGroups,
  tasks,
  taskImages,
  taskDependencies,
  reviewCards,
  events,
  aiRuns,
  cards,
  conversations,
  messages,
  rules,
};
