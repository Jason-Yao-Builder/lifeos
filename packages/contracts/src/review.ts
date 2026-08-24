import { z } from 'zod';
import { DateTimeSchema, EntityIdSchema, LocalDateSchema } from './common.js';
import { TaskDtoSchema } from './task.js';

export const CarryoverActionSchema = z.enum([
  'carry_today',
  'reschedule',
  'cool_down',
  'abandon',
]);
export type CarryoverAction = z.infer<typeof CarryoverActionSchema>;

const CarryoverBaseSchema = z.object({ taskId: EntityIdSchema });
export const CarryoverDecisionSchema = z.discriminatedUnion('action', [
  CarryoverBaseSchema.extend({ action: z.literal('carry_today') }).strict(),
  CarryoverBaseSchema.extend({
    action: z.literal('reschedule'),
    targetDate: LocalDateSchema,
  }).strict(),
  CarryoverBaseSchema.extend({ action: z.literal('cool_down') }).strict(),
  CarryoverBaseSchema.extend({ action: z.literal('abandon') }).strict(),
]);
export type CarryoverDecision = z.infer<typeof CarryoverDecisionSchema>;

export const CarryoverBatchSchema = z
  .object({ decisions: z.array(CarryoverDecisionSchema).min(1).max(500) })
  .strict();
export type CarryoverBatch = z.infer<typeof CarryoverBatchSchema>;

const TaskReferenceSchema = z
  .object({ taskId: EntityIdSchema, title: z.string().min(1).max(200) })
  .strict();

export const DailyPlanContentSchema = z
  .object({
    plannedTasks: z.array(TaskReferenceSchema),
    carryoverDecisions: z.array(CarryoverDecisionSchema),
  })
  .strict();
export type DailyPlanContent = z.infer<typeof DailyPlanContentSchema>;

export const DailyReviewContentSchema = z
  .object({
    plannedTasks: z.array(TaskReferenceSchema.extend({ completed: z.boolean() }).strict()),
    unplannedCompleted: z.array(TaskReferenceSchema),
    completionRate: z.number().min(0).max(100),
    incompleteReasons: z.array(
      z.object({ taskId: EntityIdSchema, reason: z.string().trim().min(1).max(1_000) }).strict(),
    ),
    totalFocusMinutes: z.number().int().nonnegative(),
  })
  .strict();
export type DailyReviewContent = z.infer<typeof DailyReviewContentSchema>;

export const WeeklyReviewContentSchema = z
  .object({
    plannedCount: z.number().int().nonnegative(),
    completedCount: z.number().int().nonnegative(),
    completionRate: z.number().min(0).max(100),
    temperatureChanges: z.object({ heatedTaskIds: z.array(EntityIdSchema), cooledTaskIds: z.array(EntityIdSchema) }).strict(),
    goals: z.array(z.object({ goalId: EntityIdSchema, completedTaskIds: z.array(EntityIdSchema) }).strict()),
    carriedTaskIds: z.array(EntityIdSchema),
    dailyCompleted: z.array(z.object({ date: LocalDateSchema, count: z.number().int().nonnegative() }).strict()),
    dailyCompletionRates: z.array(
      z.object({ date: LocalDateSchema, rate: z.number().min(0).max(100) }).strict(),
    ),
  })
  .strict();
export type WeeklyReviewContent = z.infer<typeof WeeklyReviewContentSchema>;

const TemperatureDistributionSchema = z
  .object({
    inspiration: z.number().int().nonnegative(),
    cold: z.number().int().nonnegative(),
    warm: z.number().int().nonnegative(),
    hot: z.number().int().nonnegative(),
  })
  .strict();

export const MonthlyTemperatureTrendPointSchema = z
  .object({
    periodStart: LocalDateSchema,
    periodEnd: LocalDateSchema,
    byTemperature: TemperatureDistributionSchema,
  })
  .strict()
  .refine((point) => point.periodStart <= point.periodEnd, {
    path: ['periodEnd'],
    message: 'periodEnd must be at or after periodStart',
  });
export type MonthlyTemperatureTrendPoint = z.infer<
  typeof MonthlyTemperatureTrendPointSchema
>;

export const MonthlyReviewContentSchema = z
  .object({
    goals: z.array(
      z.object({
        goalId: EntityIdSchema,
        title: z.string().min(1).max(200),
        monthCompleted: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        percent: z.number().min(0).max(100),
      }).strict(),
    ),
    taskCounts: z.object({ created: z.number().int().nonnegative(), completed: z.number().int().nonnegative(), abandoned: z.number().int().nonnegative() }).strict(),
    temperatureTrend: z.array(MonthlyTemperatureTrendPointSchema),
    repeatCompletionRate: z.number().min(0).max(100),
    frequentCarryovers: z.array(TaskReferenceSchema.extend({ count: z.number().int().positive() }).strict()).max(5),
  })
  .strict();
export type MonthlyReviewContent = z.infer<typeof MonthlyReviewContentSchema>;

export const ReviewTypeSchema = z.enum([
  'daily_plan',
  'daily_review',
  'weekly_review',
  'monthly_review',
]);
export type ReviewType = z.infer<typeof ReviewTypeSchema>;

export const ReviewListQuerySchema = z
  .object({
    type: ReviewTypeSchema.optional(),
    periodStart: LocalDateSchema.optional(),
    periodEnd: LocalDateSchema.optional(),
  })
  .strict()
  .refine(
    (query) => !query.periodStart || !query.periodEnd || query.periodStart <= query.periodEnd,
    { path: ['periodEnd'], message: 'periodEnd must be at or after periodStart' },
  );
export type ReviewListQuery = z.infer<typeof ReviewListQuerySchema>;

const ReviewCardInputBaseSchema = z.object({
  periodStart: LocalDateSchema,
  periodEnd: LocalDateSchema,
});

const CreateReviewCardUnionSchema = z.discriminatedUnion('type', [
  ReviewCardInputBaseSchema.extend({ type: z.literal('daily_plan'), content: DailyPlanContentSchema }).strict(),
  ReviewCardInputBaseSchema.extend({ type: z.literal('daily_review'), content: DailyReviewContentSchema }).strict(),
  ReviewCardInputBaseSchema.extend({ type: z.literal('weekly_review'), content: WeeklyReviewContentSchema }).strict(),
  ReviewCardInputBaseSchema.extend({ type: z.literal('monthly_review'), content: MonthlyReviewContentSchema }).strict(),
]);
export const CreateReviewCardInputSchema = CreateReviewCardUnionSchema.refine(
  (input) => input.periodStart <= input.periodEnd,
  { path: ['periodEnd'], message: 'periodEnd must be at or after periodStart' },
);
export type CreateReviewCardInput = z.infer<typeof CreateReviewCardInputSchema>;

const ReviewCardBaseSchema = z.object({
  id: EntityIdSchema,
  workspaceId: EntityIdSchema,
  ownerId: EntityIdSchema,
  periodStart: LocalDateSchema,
  periodEnd: LocalDateSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});

const ReviewCardRecordUnionSchema = z.discriminatedUnion('type', [
  ReviewCardBaseSchema.extend({ type: z.literal('daily_plan'), content: DailyPlanContentSchema }).strict(),
  ReviewCardBaseSchema.extend({ type: z.literal('daily_review'), content: DailyReviewContentSchema }).strict(),
  ReviewCardBaseSchema.extend({ type: z.literal('weekly_review'), content: WeeklyReviewContentSchema }).strict(),
  ReviewCardBaseSchema.extend({ type: z.literal('monthly_review'), content: MonthlyReviewContentSchema }).strict(),
]);
export const ReviewCardRecordSchema = ReviewCardRecordUnionSchema.refine(
  (record) => record.periodStart <= record.periodEnd,
  { path: ['periodEnd'], message: 'periodEnd must be at or after periodStart' },
);
export type ReviewCardRecord = z.infer<typeof ReviewCardRecordSchema>;

export const MorningPlanningSchema = z
  .object({
    unfinished: z.array(TaskDtoSchema),
    planned: z.array(TaskDtoSchema),
    deadlineToday: z.array(TaskDtoSchema),
  })
  .strict();
export type MorningPlanning = z.infer<typeof MorningPlanningSchema>;
