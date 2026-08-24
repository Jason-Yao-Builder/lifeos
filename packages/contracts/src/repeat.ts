import { z } from 'zod';
import { DateTimeSchema, EntityIdSchema, LocalDateSchema } from './common.js';
import { TemperatureSchema } from './enums.js';

const TagsSchema = z
  .array(z.string().trim().min(1).max(50))
  .max(50)
  .refine((tags) => new Set(tags).size === tags.length, 'Tags must be unique');

function isValidCronField(field: string, min: number, max: number): boolean {
  return field.split(',').every((part) => {
    const segments = part.split('/');
    if (segments.length > 2 || !segments[0]) return false;
    if (segments[1] !== undefined && (!/^\d+$/.test(segments[1]) || Number(segments[1]) < 1)) {
      return false;
    }
    if (segments[0] === '*') return true;
    const bounds = segments[0].split('-');
    if (bounds.length > 2 || bounds.some((bound) => !/^\d+$/.test(bound))) return false;
    const start = Number(bounds[0]);
    const end = Number(bounds[1] ?? bounds[0]);
    return start >= min && end <= max && start <= end;
  });
}

function isValidCronExpression(value: string): boolean {
  const fields = value.split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return Boolean(
    minute &&
      hour &&
      dayOfMonth &&
      month &&
      dayOfWeek &&
      isValidCronField(minute, 0, 59) &&
      isValidCronField(hour, 0, 23) &&
      isValidCronField(dayOfMonth, 1, 31) &&
      isValidCronField(month, 1, 12) &&
      isValidCronField(dayOfWeek, 0, 7),
  );
}

export const CronExpressionSchema = z
  .string()
  .trim()
  .min(9)
  .max(200)
  .refine(
    isValidCronExpression,
    'Expected a five-field numeric cron expression',
  );
export type CronExpression = z.infer<typeof CronExpressionSchema>;

export const TimeZoneSchema = z.string().trim().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, 'Invalid IANA timezone');
export type TimeZone = z.infer<typeof TimeZoneSchema>;

export const RepeatTemplateWritableSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(10_000).nullable().optional(),
    temperature: TemperatureSchema.optional(),
    tags: TagsSchema.optional(),
    estimatedMinutes: z.number().int().positive().max(525_600).nullable().optional(),
    goalId: EntityIdSchema.nullable().optional(),
    cronExpr: CronExpressionSchema,
    timezone: TimeZoneSchema.optional(),
    horizonDays: z.number().int().min(1).max(365).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();
export type RepeatTemplateWritable = z.infer<typeof RepeatTemplateWritableSchema>;

export const CreateRepeatTemplateInputSchema = RepeatTemplateWritableSchema.extend({
  description: RepeatTemplateWritableSchema.shape.description.default(null),
  temperature: TemperatureSchema.default('warm'),
  tags: TagsSchema.default([]),
  estimatedMinutes: RepeatTemplateWritableSchema.shape.estimatedMinutes.default(null),
  goalId: RepeatTemplateWritableSchema.shape.goalId.default(null),
  timezone: TimeZoneSchema.default('Asia/Shanghai'),
  horizonDays: z.number().int().min(1).max(365).default(28),
  enabled: z.boolean().default(true),
}).strict();
export type CreateRepeatTemplateRequest = z.input<typeof CreateRepeatTemplateInputSchema>;
export type CreateRepeatTemplateInput = z.output<typeof CreateRepeatTemplateInputSchema>;

export const UpdateRepeatTemplateInputSchema = RepeatTemplateWritableSchema.partial()
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required');
export type UpdateRepeatTemplateInput = z.infer<typeof UpdateRepeatTemplateInputSchema>;

export const RepeatTemplateRecordSchema = z
  .object({
    id: EntityIdSchema,
    workspaceId: EntityIdSchema,
    ownerId: EntityIdSchema,
    title: z.string().min(1).max(200),
    description: z.string().max(10_000).nullable(),
    temperature: TemperatureSchema,
    tags: TagsSchema,
    estimatedMinutes: z.number().int().positive().max(525_600).nullable(),
    goalId: EntityIdSchema.nullable(),
    cronExpr: CronExpressionSchema,
    timezone: TimeZoneSchema,
    horizonDays: z.number().int().min(1).max(365),
    enabled: z.boolean(),
    lastGenerated: LocalDateSchema.nullable(),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
    deletedAt: DateTimeSchema.nullable(),
  })
  .strict();
export type RepeatTemplateRecord = z.infer<typeof RepeatTemplateRecordSchema>;

export const RepeatGenerationPlanSchema = z
  .object({
    templateId: EntityIdSchema,
    dates: z.array(LocalDateSchema),
    lastGenerated: LocalDateSchema.nullable(),
  })
  .strict();
export type RepeatGenerationPlan = z.infer<typeof RepeatGenerationPlanSchema>;
