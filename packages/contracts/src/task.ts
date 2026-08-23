import { z } from 'zod';
import { DateTimeSchema, EntityIdSchema, LocalDateSchema } from './common.js';
import { HardnessSchema, TaskStatusSchema, TemperatureSchema } from './enums.js';

const TagSchema = z.string().trim().min(1).max(50);
const TagsSchema = z
  .array(TagSchema)
  .max(50)
  .refine((tags) => new Set(tags).size === tags.length, 'Tags must be unique');

export const TaskScoreDimensionsSchema = z
  .object({
    impact: z.number().min(0).max(100),
    urgency: z.number().min(0).max(100),
    alignment: z.number().min(0).max(100),
    effort: z.number().min(0).max(100),
  })
  .strict();
export type TaskScoreDimensions = z.infer<typeof TaskScoreDimensionsSchema>;

export const TaskScoreWeightsSchema = z
  .object({
    impact: z.number().nonnegative(),
    urgency: z.number().nonnegative(),
    alignment: z.number().nonnegative(),
    effort: z.number().nonnegative(),
  })
  .strict()
  .refine((weights) => Object.values(weights).some((weight) => weight > 0), {
    message: 'At least one score weight must be positive',
  });
export type TaskScoreWeights = z.infer<typeof TaskScoreWeightsSchema>;

const WritableTaskFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(10_000).nullable(),
    temperature: TemperatureSchema,
    status: TaskStatusSchema,
    tags: TagsSchema,
    deadline: DateTimeSchema.nullable(),
    plannedDate: LocalDateSchema.nullable(),
    startAt: DateTimeSchema.nullable(),
    endAt: DateTimeSchema.nullable(),
    estimatedMinutes: z.number().int().positive().max(525_600).nullable(),
  })
  .strict();

export const CreateTaskInputSchema = WritableTaskFieldsSchema.extend({
  description: WritableTaskFieldsSchema.shape.description.default(null),
  temperature: WritableTaskFieldsSchema.shape.temperature.default('inspiration'),
  status: z.literal('todo').default('todo'),
  tags: WritableTaskFieldsSchema.shape.tags.default([]),
  deadline: WritableTaskFieldsSchema.shape.deadline.default(null),
  plannedDate: WritableTaskFieldsSchema.shape.plannedDate.default(null),
  startAt: WritableTaskFieldsSchema.shape.startAt.default(null),
  endAt: WritableTaskFieldsSchema.shape.endAt.default(null),
  estimatedMinutes: WritableTaskFieldsSchema.shape.estimatedMinutes.default(null),
  scoreDimensions: TaskScoreDimensionsSchema.nullable().default(null),
}).strict();
export type CreateTaskRequest = z.input<typeof CreateTaskInputSchema>;
export type CreateTaskInput = z.output<typeof CreateTaskInputSchema>;

export const UpdateTaskInputSchema = WritableTaskFieldsSchema.partial()
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required');
export type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>;

export const TaskRecordSchema = WritableTaskFieldsSchema.extend({
  id: EntityIdSchema,
  tenantId: EntityIdSchema,
  ownerId: EntityIdSchema,
  actualMinutes: z.number().int().nonnegative(),
  scoreDimensions: TaskScoreDimensionsSchema.nullable(),
  score: z.number().min(0).max(100).nullable(),
  rank: z.number().finite(),
  version: z.number().int().positive(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
  completedAt: DateTimeSchema.nullable(),
  deletedAt: DateTimeSchema.nullable(),
}).strict();
export type TaskRecord = z.infer<typeof TaskRecordSchema>;

export const TaskDtoSchema = TaskRecordSchema.extend({ hardness: HardnessSchema }).strict();
export type TaskDto = z.infer<typeof TaskDtoSchema>;
