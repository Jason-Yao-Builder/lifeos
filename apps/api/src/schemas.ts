import {
  CardStatusSchema,
  CardTypeSchema,
  DateTimeSchema,
  EntityIdSchema,
  LocalDateSchema,
  TaskStatusSchema,
  TaskScoreDimensionsSchema,
  TemperatureSchema,
  UpdateTaskInputSchema,
} from '@lifeos/contracts';
import { z } from 'zod';

export const IdParamsSchema = z.object({ id: EntityIdSchema }).strict();
export const TaskImageTaskParamsSchema = z.object({ taskId: EntityIdSchema }).strict();
export const TaskImageParamsSchema = z
  .object({ taskId: EntityIdSchema, imageId: EntityIdSchema })
  .strict();
export const DayParamsSchema = z.object({ date: LocalDateSchema }).strict();

export const TaskListQuerySchema = z
  .object({
    temperature: TemperatureSchema.optional(),
    status: TaskStatusSchema.optional(),
    tag: z.string().trim().min(1).max(50).optional(),
    query: z.string().trim().min(1).max(200).optional(),
    deadlineFrom: DateTimeSchema.optional(),
    deadlineTo: DateTimeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();

export const TaskPatchBodySchema = z
  .object({ version: z.number().int().positive(), patch: UpdateTaskInputSchema })
  .strict();
export const TaskDeleteQuerySchema = z
  .object({ version: z.coerce.number().int().positive() })
  .strict();
export const ReorderBodySchema = z
  .object({
    orderedIds: z
      .array(EntityIdSchema)
      .min(1)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, 'Task ids must be unique'),
  })
  .strict();

export const RollForwardDeadlinesBodySchema = z
  .object({
    targetDate: LocalDateSchema,
    tasks: z
      .array(
        z
          .object({
            id: EntityIdSchema,
            version: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(500)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
        'Task ids must be unique',
      ),
  })
  .strict();

export const CardListQuerySchema = z
  .object({
    status: CardStatusSchema.optional(),
    type: CardTypeSchema.optional(),
    targetTaskId: EntityIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();
export const CardDecisionBodySchema = z.union([
  z
    .object({
      version: z.number().int().positive(),
      status: z.enum(['accepted', 'rejected', 'dismissed', 'resolved', 'archived']),
      decision: z.unknown().optional(),
    })
    .strict(),
  z.object({ decision: z.enum(['accept', 'reject']) }).strict(),
]);
export const CardDiscussBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200).nullable().optional(),
    message: z.string().trim().min(1).max(20_000).optional(),
  })
  .strict();

export const ConversationListQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(500).optional() })
  .strict();
export const CreateConversationBodySchema = z
  .object({
    cardId: EntityIdSchema.nullable().optional(),
    title: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .strict();
export const AddMessageBodySchema = z
  .object({
    role: z.enum(['user', 'assistant', 'system']).default('user'),
    content: z.string().trim().min(1).max(20_000),
    metadata: z.unknown().optional(),
  })
  .strict();

export const ScoreTasksBodySchema = z
  .object({ taskIds: z.array(EntityIdSchema).max(500).optional() })
  .strict();
export const DailySummaryBodySchema = z
  .object({ date: LocalDateSchema.optional() })
  .strict();

const JsonObjectSchema = z.record(z.string(), z.unknown());
export const RuleListQuerySchema = z
  .object({ enabled: z.enum(['true', 'false']).transform((value) => value === 'true').optional() })
  .strict();
export const RulePatchBodySchema = z
  .object({
    version: z.number().int().positive(),
    patch: z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        enabled: z.boolean().optional(),
        trigger: JsonObjectSchema.optional(),
        condition: JsonObjectSchema.optional(),
        action: JsonObjectSchema.optional(),
        config: JsonObjectSchema.optional(),
      })
      .strict()
      .refine((patch) => Object.keys(patch).length > 0, 'Rule patch must not be empty'),
  })
  .strict();
export const LegacyRulePatchBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    parameters: JsonObjectSchema.optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'Rule patch must not be empty');
export const RuleEvaluateBodySchema = z
  .object({ now: DateTimeSchema.optional() })
  .strict();

export const DebugEventsQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(500).optional() })
  .strict();

export const AiTaskScoreSchema = z
  .object({
    taskId: EntityIdSchema,
    dimensions: TaskScoreDimensionsSchema,
    score: z.number().min(0).max(100),
    explanation: z.string().trim().min(1).max(2_000),
  })
  .strict();
export const AiTaskScoresSchema = z.array(AiTaskScoreSchema).max(500);

export const AiDailySummarySchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(20_000),
    observations: z.array(z.string().max(2_000)).max(50).optional(),
    focusTaskIds: z.array(EntityIdSchema).max(100).optional(),
    explanation: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

export const AiChatReplySchema = z
  .object({
    content: z.string().trim().min(1).max(20_000),
    explanation: z.string().trim().min(1).max(2_000),
  })
  .strict();
