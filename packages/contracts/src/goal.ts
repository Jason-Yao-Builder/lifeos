import { z } from 'zod';
import { DateTimeSchema, EntityIdSchema } from './common.js';
import { TemperatureSchema } from './enums.js';

export const GoalStatusSchema = z.enum(['active', 'completed', 'abandoned']);
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

export const GoalListQuerySchema = z.object({ status: GoalStatusSchema.optional() }).strict();
export type GoalListQuery = z.infer<typeof GoalListQuerySchema>;

export const GoalWritableSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(10_000).nullable().optional(),
    timeframe: z.string().trim().max(200).nullable().optional(),
    status: GoalStatusSchema.optional(),
  })
  .strict();
export type GoalWritable = z.infer<typeof GoalWritableSchema>;

export const CreateGoalInputSchema = GoalWritableSchema.extend({
  description: GoalWritableSchema.shape.description.default(null),
  timeframe: GoalWritableSchema.shape.timeframe.default(null),
  status: GoalStatusSchema.default('active'),
}).strict();
export type CreateGoalRequest = z.input<typeof CreateGoalInputSchema>;
export type CreateGoalInput = z.output<typeof CreateGoalInputSchema>;

export const UpdateGoalInputSchema = GoalWritableSchema.partial()
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required');
export type UpdateGoalInput = z.infer<typeof UpdateGoalInputSchema>;

export const GoalRecordSchema = z
  .object({
    id: EntityIdSchema,
    workspaceId: EntityIdSchema,
    ownerId: EntityIdSchema,
    title: z.string().trim().min(1).max(200),
    description: z.string().max(10_000).nullable(),
    timeframe: z.string().max(200).nullable(),
    status: GoalStatusSchema,
    rank: z.number().finite(),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
    completedAt: DateTimeSchema.nullable(),
    deletedAt: DateTimeSchema.nullable(),
  })
  .strict();
export type GoalRecord = z.infer<typeof GoalRecordSchema>;

export const GoalProgressSchema = z
  .object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    percent: z.number().int().min(0).max(100),
    byTemperature: z.record(TemperatureSchema, z.number().int().nonnegative()),
  })
  .strict();
export type GoalProgress = z.infer<typeof GoalProgressSchema>;
