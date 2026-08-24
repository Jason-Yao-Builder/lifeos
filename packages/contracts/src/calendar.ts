import { z } from 'zod';
import { DateTimeSchema, LocalDateSchema } from './common.js';
import { TaskDtoSchema } from './task.js';

export const CalendarViewSchema = z.enum(['month', 'week', 'day']);
export type CalendarView = z.infer<typeof CalendarViewSchema>;

export const CalendarQuerySchema = z
  .object({
    start: LocalDateSchema,
    end: LocalDateSchema,
    view: CalendarViewSchema.default('month'),
  })
  .strict()
  .refine((query) => query.start <= query.end, {
    path: ['end'],
    message: 'end must be at or after start',
  });
export type CalendarQuery = z.infer<typeof CalendarQuerySchema>;

export const CalendarDaySchema = z
  .object({
    tasks: z.array(TaskDtoSchema),
    deadlineTasks: z.array(TaskDtoSchema),
    repeatTasks: z.array(TaskDtoSchema),
  })
  .strict();
export type CalendarDay = z.infer<typeof CalendarDaySchema>;

export const CalendarResponseSchema = z
  .object({ days: z.record(LocalDateSchema, CalendarDaySchema) })
  .strict();
export type CalendarResponse = z.infer<typeof CalendarResponseSchema>;

const RescheduleTaskCanonicalSchema = z
  .object({
    version: z.number().int().positive(),
    plannedDate: LocalDateSchema,
    startsAt: DateTimeSchema.nullable().optional(),
    endsAt: DateTimeSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (input) => !input.startsAt || !input.endsAt || Date.parse(input.startsAt) <= Date.parse(input.endsAt),
    { path: ['endsAt'], message: 'endsAt must be at or after startsAt' },
  );

export const RescheduleTaskInputSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  const hasSingular = 'startAt' in input || 'endAt' in input;
  const hasPlural = 'startsAt' in input || 'endsAt' in input;
  if (!hasSingular || hasPlural) return value;
  const { startAt, endAt, ...rest } = input;
  return { ...rest, startsAt: startAt, endsAt: endAt };
}, RescheduleTaskCanonicalSchema);
export type RescheduleTaskInput = z.infer<typeof RescheduleTaskInputSchema>;
