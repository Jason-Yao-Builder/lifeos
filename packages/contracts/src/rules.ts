import { z } from 'zod';
import { EntityIdSchema, LocalDateSchema } from './common.js';
import { CardTypeSchema, TemperatureSchema } from './enums.js';

export const PresetRuleIdSchema = z.enum([
  'deadline-auto-heat',
  'stale-task-observation',
  'friday-hot-demotion',
]);
export type PresetRuleId = z.infer<typeof PresetRuleIdSchema>;

export const RuleActionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('change_temperature'),
      value: TemperatureSchema,
      requireConfirmation: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('create_card'),
      cardType: CardTypeSchema,
      title: z.string().trim().min(1).max(200),
      body: z.string().trim().min(1).max(20_000),
      requireConfirmation: z.boolean(),
    })
    .strict(),
]);
export type RuleAction = z.infer<typeof RuleActionSchema>;

export const RuleProposalSchema = z
  .object({
    ruleId: PresetRuleIdSchema,
    taskId: EntityIdSchema,
    effectiveDate: LocalDateSchema,
    idempotencyKey: z.string().min(1).max(512),
    reason: z.string().min(1).max(1_000),
    action: RuleActionSchema,
  })
  .strict();
export type RuleProposal = z.infer<typeof RuleProposalSchema>;
