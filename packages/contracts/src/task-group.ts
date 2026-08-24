import { z } from 'zod';
import { DateTimeSchema, EntityIdSchema } from './common.js';

export const TaskGroupNameSchema = z.string().trim().min(1).max(100);
export const TaskGroupColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must use #RRGGBB format')
  .transform((value) => value.toUpperCase());

export const TaskGroupSchema = z
  .object({
    id: EntityIdSchema,
    workspaceId: EntityIdSchema,
    name: TaskGroupNameSchema,
    color: TaskGroupColorSchema,
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
  })
  .strict();
export type TaskGroup = z.infer<typeof TaskGroupSchema>;

export const TaskGroupListResponseSchema = z
  .object({ items: z.array(TaskGroupSchema) })
  .strict();
export type TaskGroupListResponse = z.infer<typeof TaskGroupListResponseSchema>;

export const CreateTaskGroupInputSchema = z
  .object({
    name: TaskGroupNameSchema,
    color: TaskGroupColorSchema,
  })
  .strict();
export type CreateTaskGroupInput = z.infer<typeof CreateTaskGroupInputSchema>;

export const UpdateTaskGroupInputSchema = CreateTaskGroupInputSchema.partial()
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'At least one field is required');
export type UpdateTaskGroupInput = z.infer<typeof UpdateTaskGroupInputSchema>;
