import { z } from 'zod';
import { DateTimeSchema, EntityIdSchema } from './common.js';
import { CardStatusSchema, CardTypeSchema } from './enums.js';

export const CardSchema = z
  .object({
    id: EntityIdSchema,
    tenantId: EntityIdSchema,
    type: CardTypeSchema,
    status: CardStatusSchema,
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(20_000),
    targetTaskId: EntityIdSchema.nullable(),
    hasDiscussion: z.boolean(),
    createdAt: DateTimeSchema,
    updatedAt: DateTimeSchema,
    resolvedAt: DateTimeSchema.nullable(),
  })
  .strict();
export type Card = z.infer<typeof CardSchema>;

export const CreateCardInputSchema = CardSchema.pick({
  type: true,
  title: true,
  body: true,
  targetTaskId: true,
}).strict();
export type CreateCardInput = z.infer<typeof CreateCardInputSchema>;
