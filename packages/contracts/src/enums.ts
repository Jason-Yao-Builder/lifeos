import { z } from 'zod';

export const TemperatureSchema = z.enum(['hot', 'warm', 'cold', 'inspiration']);
export type Temperature = z.infer<typeof TemperatureSchema>;

export const HardnessSchema = z.enum(['hard', 'soft']);
export type Hardness = z.infer<typeof HardnessSchema>;

export const TaskStatusSchema = z.enum([
  'todo',
  'in_progress',
  'completed',
  'abandoned',
  'archived',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const CardTypeSchema = z.enum(['action', 'observation', 'generation']);
export type CardType = z.infer<typeof CardTypeSchema>;

export const CardStatusSchema = z.enum([
  'pending',
  'accepted',
  'rejected',
  'dismissed',
  'discussing',
  'resolved',
  'archived',
]);
export type CardStatus = z.infer<typeof CardStatusSchema>;

export const ChangeActorSchema = z.enum(['human', 'ai', 'rule', 'system']);
export type ChangeActor = z.infer<typeof ChangeActorSchema>;
