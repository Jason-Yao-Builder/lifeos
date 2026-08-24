import { z } from 'zod';
import { DateTimeSchema, EntityIdSchema } from './common.js';

export const DependencyTypeSchema = z.enum(['finish_to_start']);
export type DependencyType = z.infer<typeof DependencyTypeSchema>;

export const TaskDependencyInputSchema = z
  .object({
    predecessorId: EntityIdSchema,
    type: DependencyTypeSchema.default('finish_to_start'),
  })
  .strict();
export type TaskDependencyRequest = z.input<typeof TaskDependencyInputSchema>;
export type TaskDependencyInput = z.output<typeof TaskDependencyInputSchema>;

export const TaskDependencyRecordSchema = z
  .object({
    id: EntityIdSchema,
    workspaceId: EntityIdSchema,
    predecessorId: EntityIdSchema,
    successorId: EntityIdSchema,
    type: DependencyTypeSchema,
    createdAt: DateTimeSchema,
  })
  .strict();
export type TaskDependencyRecord = z.infer<typeof TaskDependencyRecordSchema>;

export const DependencyDtoSchema = TaskDependencyRecordSchema;
export type DependencyDto = TaskDependencyRecord;

export const TaskDependenciesSchema = z
  .object({
    predecessors: z.array(TaskDependencyRecordSchema),
    successors: z.array(TaskDependencyRecordSchema),
    isBlocked: z.boolean(),
  })
  .strict();
export type TaskDependencies = z.infer<typeof TaskDependenciesSchema>;
