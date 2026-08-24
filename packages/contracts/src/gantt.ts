import { z } from 'zod';
import { DateTimeSchema, EntityIdSchema, LocalDateSchema } from './common.js';
import { TaskDependencyRecordSchema } from './dependency.js';
import { TaskDtoSchema } from './task.js';

export const GanttScaleSchema = z.enum(['day', 'week', 'month']);
export type GanttScale = z.infer<typeof GanttScaleSchema>;

export const GanttQuerySchema = z
  .object({
    start: LocalDateSchema,
    end: LocalDateSchema,
    goalId: EntityIdSchema.optional(),
  })
  .strict()
  .refine((query) => query.start <= query.end, {
    path: ['end'],
    message: 'end must be at or after start',
  });
export type GanttQuery = z.infer<typeof GanttQuerySchema>;

export const TaskProgressSchema = z
  .object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    percent: z.number().int().min(0).max(100),
  })
  .strict();
export type TaskProgress = z.infer<typeof TaskProgressSchema>;

export const GanttTaskDtoSchema = TaskDtoSchema.omit({ startAt: true, endAt: true }).extend({
  startsAt: DateTimeSchema.nullable(),
  endsAt: DateTimeSchema.nullable(),
  progress: TaskProgressSchema,
}).strict();
export type GanttTaskDto = z.infer<typeof GanttTaskDtoSchema>;

export const GanttResponseSchema = z
  .object({
    tasks: z.array(GanttTaskDtoSchema),
    dependencies: z.array(TaskDependencyRecordSchema),
    criticalPath: z.array(EntityIdSchema),
  })
  .strict();
export type GanttResponse = z.infer<typeof GanttResponseSchema>;

const TaskTimespanCanonicalSchema = z
  .object({
    version: z.number().int().positive(),
    startAt: DateTimeSchema,
    endAt: DateTimeSchema,
  })
  .strict()
  .refine((input) => Date.parse(input.startAt) <= Date.parse(input.endAt), {
    path: ['endAt'],
    message: 'endAt must be at or after startAt',
  });

export const TaskTimespanInputSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  const hasPlural = 'startsAt' in input || 'endsAt' in input;
  const hasSingular = 'startAt' in input || 'endAt' in input;
  if (!hasPlural || hasSingular) return value;
  const { startsAt, endsAt, ...rest } = input;
  return { ...rest, startAt: startsAt, endAt: endsAt };
}, TaskTimespanCanonicalSchema);
export type TaskTimespanInput = z.infer<typeof TaskTimespanInputSchema>;
