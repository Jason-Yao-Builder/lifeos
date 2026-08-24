import {
  TaskScoreDimensionsSchema,
  TaskScoreWeightsSchema,
  type TaskScoreDimensions,
  type TaskScoreWeights,
  type TaskScoreWeightsInput,
} from '@lifeos/contracts';

export const DEFAULT_SCORE_WEIGHTS: Readonly<TaskScoreWeights> = {
  impact: 0.4,
  urgency: 0.35,
  alignment: 0.25,
};

export type TaskScoreContributions = Pick<
  TaskScoreDimensions,
  'impact' | 'urgency' | 'alignment'
>;

export interface TaskScoreResult {
  score: number;
  normalizedWeights: TaskScoreWeights;
  contributions: TaskScoreContributions;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function calculateTaskScore(
  input: TaskScoreDimensions,
  weights: TaskScoreWeightsInput = DEFAULT_SCORE_WEIGHTS,
): TaskScoreResult {
  const dimensions = TaskScoreDimensionsSchema.parse(input);
  const validWeights = TaskScoreWeightsSchema.parse(weights);
  const totalWeight = Object.values(validWeights).reduce((sum, weight) => sum + weight, 0);
  const normalizedWeights: TaskScoreWeights = {
    impact: round(validWeights.impact / totalWeight, 8),
    urgency: round(validWeights.urgency / totalWeight, 8),
    alignment: round(validWeights.alignment / totalWeight, 8),
  };
  const contributions: TaskScoreContributions = {
    impact: round(dimensions.impact * normalizedWeights.impact, 4),
    urgency: round(dimensions.urgency * normalizedWeights.urgency, 4),
    alignment: round(dimensions.alignment * normalizedWeights.alignment, 4),
  };
  const score = round(Object.values(contributions).reduce((sum, value) => sum + value, 0), 2);

  return { score, normalizedWeights, contributions };
}

export const scoreTask = calculateTaskScore;
