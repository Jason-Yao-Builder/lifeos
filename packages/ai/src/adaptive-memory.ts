import type { DurationObservation } from './adaptive-types.js';
import { durationCalibrationFactor } from './duration-model.js';

export interface DurationMemoryEvaluation {
  kind: 'duration-calibration-memory';
  status: 'promoted' | 'candidate' | 'rejected';
  factor: number;
  evidenceCount: number;
  validationCount: number;
  baselineMae: number | null;
  calibratedMae: number | null;
  relativeImprovement: number | null;
  explanation: string;
}

const meanAbsoluteError = (
  observations: readonly DurationObservation[],
  factor: number,
): number => observations.reduce(
  (sum, item) => sum + Math.abs(item.actualMinutes - item.estimatedMinutes * factor),
  0,
) / observations.length;

export function evaluateDurationMemory(
  observations: readonly DurationObservation[],
): DurationMemoryEvaluation {
  const valid = observations.filter((item) =>
    Number.isFinite(item.estimatedMinutes) && item.estimatedMinutes > 0 &&
    Number.isFinite(item.actualMinutes) && item.actualMinutes > 0,
  );
  if (valid.length < 8) {
    return {
      kind: 'duration-calibration-memory', status: 'candidate', factor: 1,
      evidenceCount: valid.length, validationCount: 0, baselineMae: null,
      calibratedMae: null, relativeImprovement: null,
      explanation: '至少需要 8 个有效完成样本，当前只保留为候选记忆。',
    };
  }
  const split = Math.max(6, Math.floor(valid.length * 0.75));
  const training = valid.slice(0, split);
  const validation = valid.slice(split);
  const factor = durationCalibrationFactor(training);
  const baselineMae = meanAbsoluteError(validation, 1);
  const calibratedMae = meanAbsoluteError(validation, factor);
  const relativeImprovement = baselineMae === 0
    ? (calibratedMae === 0 ? 0 : -1)
    : (baselineMae - calibratedMae) / baselineMae;
  const promoted = factor !== 1 && validation.length >= 2 && relativeImprovement >= 0.1;
  return {
    kind: 'duration-calibration-memory',
    status: promoted ? 'promoted' : 'rejected',
    factor: promoted ? factor : 1,
    evidenceCount: training.length,
    validationCount: validation.length,
    baselineMae: Number(baselineMae.toFixed(2)),
    calibratedMae: Number(calibratedMae.toFixed(2)),
    relativeImprovement: Number(relativeImprovement.toFixed(3)),
    explanation: promoted
      ? `留出验证集误差下降 ${Math.round(relativeImprovement * 100)}%，允许晋升为规划记忆。`
      : '校准未在留出样本上稳定改善，拒绝写入长期规划记忆。',
  };
}
