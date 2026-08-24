import type { TaskScoreDimensions } from '@lifeos/contracts';
import type {
  aiRuns,
  cards,
  conversations,
  events,
  goals,
  messages,
  repeatTemplates,
  reviewCards,
  rules,
  taskDependencies,
  tasks,
} from '../schema.js';
import { decodeJson, decodeStringArray } from '../json.js';
import type {
  AiRunRecord,
  CardRecord,
  ConversationRecord,
  EventRecord,
  GoalRecord,
  MessageRecord,
  RepeatTemplateRecord,
  ReviewCardRecord,
  RuleRecord,
  TaskDependencyRecord,
  TaskRecord,
} from '../types.js';

export const mapTask = (row: typeof tasks.$inferSelect): TaskRecord => ({
  id: row.id,
  tenantId: row.workspaceId,
  ownerId: row.ownerId,
  title: row.title,
  description: row.description,
  temperature: row.temperature,
  status: row.status,
  deadline: row.deadlineAt,
  plannedDate: row.plannedDate,
  startAt: row.startsAt,
  endAt: row.endsAt,
  estimatedMinutes: row.estimatedMinutes,
  actualMinutes: row.actualMinutes,
  parentTaskId: row.parentTaskId,
  goalId: row.goalId,
  repeatTemplateId: row.repeatTemplateId,
  plannedStartTime: row.plannedStartTime,
  plannedEndTime: row.plannedEndTime,
  carryOverFrom: row.carryOverFrom,
  tags: decodeStringArray(row.tagsJson),
  scoreDimensions: decodeJson(row.scoreDimensionsJson) as TaskScoreDimensions | null,
  score: row.score,
  rank: row.rank,
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  completedAt: row.completedAt,
  deletedAt: row.deletedAt,
});

export const mapGoal = (row: typeof goals.$inferSelect): GoalRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  ownerId: row.ownerId,
  title: row.title,
  description: row.description,
  timeframe: row.timeframe,
  status: row.status,
  rank: row.rank,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  completedAt: row.completedAt,
  deletedAt: row.deletedAt,
});

export const mapTaskDependency = (
  row: typeof taskDependencies.$inferSelect,
): TaskDependencyRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  predecessorId: row.predecessorId,
  successorId: row.successorId,
  type: row.type,
  createdAt: row.createdAt,
});

export const mapRepeatTemplate = (
  row: typeof repeatTemplates.$inferSelect,
): RepeatTemplateRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  ownerId: row.ownerId,
  title: row.title,
  description: row.description,
  temperature: row.temperature,
  tags: decodeStringArray(row.tagsJson),
  estimatedMinutes: row.estimatedMinutes,
  goalId: row.goalId,
  cronExpr: row.cronExpr,
  timezone: row.timezone,
  horizonDays: row.horizonDays,
  enabled: row.enabled,
  lastGenerated: row.lastGenerated,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
});

export const mapReviewCard = (
  row: typeof reviewCards.$inferSelect,
): ReviewCardRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  ownerId: row.ownerId,
  type: row.type,
  periodStart: row.periodStart,
  periodEnd: row.periodEnd,
  content: decodeJson(row.contentJson),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const mapEvent = (row: typeof events.$inferSelect): EventRecord => ({
  id: row.id,
  tenantId: row.workspaceId,
  aggregateType: row.aggregateType,
  aggregateId: row.aggregateId,
  type: row.type,
  actorType: row.actorType,
  actorId: row.actorId,
  before: decodeJson(row.beforeJson),
  after: decodeJson(row.afterJson),
  metadata: decodeJson(row.metadataJson),
  correlationId: row.correlationId,
  createdAt: row.createdAt,
});

export const mapCard = (row: typeof cards.$inferSelect): CardRecord => ({
  id: row.id,
  tenantId: row.workspaceId,
  targetTaskId: row.taskId,
  aiRunId: row.aiRunId,
  type: row.type,
  status: row.status,
  title: row.title,
  body: row.body,
  hasDiscussion: row.hasDiscussion,
  proposal: decodeJson(row.proposalJson),
  decision: decodeJson(row.decisionJson),
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  resolvedAt: row.decidedAt,
});

export const mapConversation = (
  row: typeof conversations.$inferSelect,
): ConversationRecord => ({
  id: row.id,
  tenantId: row.workspaceId,
  cardId: row.cardId,
  title: row.title,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const mapMessage = (row: typeof messages.$inferSelect): MessageRecord => ({
  ...row,
  metadata: decodeJson(row.metadataJson),
});

export const mapRule = (row: typeof rules.$inferSelect): RuleRecord => ({
  id: row.id,
  tenantId: row.workspaceId,
  name: row.name,
  enabled: row.enabled,
  trigger: decodeJson(row.triggerJson),
  condition: decodeJson(row.conditionJson),
  action: decodeJson(row.actionJson),
  config: decodeJson(row.configJson),
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const mapAiRun = (row: typeof aiRuns.$inferSelect): AiRunRecord => ({
  id: row.id,
  tenantId: row.workspaceId,
  purpose: row.purpose,
  status: row.status,
  provider: row.provider,
  model: row.model,
  input: decodeJson(row.inputJson),
  output: decodeJson(row.outputJson),
  explanation: row.explanation,
  error: row.error,
  idempotencyKey: row.idempotencyKey,
  createdAt: row.createdAt,
  completedAt: row.completedAt,
});
