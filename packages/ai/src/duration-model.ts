import type { DurationObservation } from './adaptive-types.js';

const MIN_FACTOR = 0.5;
const MAX_FACTOR = 2;
const MIN_OBSERVATIONS = 6;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const current = sorted[middle] ?? 1;
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? current) + current) / 2
    : current;
}

export function durationCalibrationFactor(
  observations: readonly DurationObservation[] = [],
): number {
  const ratios = observations.flatMap(({ estimatedMinutes, actualMinutes }) => {
    if (
      !Number.isFinite(estimatedMinutes) ||
      !Number.isFinite(actualMinutes) ||
      estimatedMinutes <= 0 ||
      actualMinutes <= 0
    ) {
      return [];
    }
    return [clamp(actualMinutes / estimatedMinutes, MIN_FACTOR, MAX_FACTOR)];
  });
  if (ratios.length < MIN_OBSERVATIONS) return 1;
  return Number(median(ratios).toFixed(3));
}

export function calibratedDurationMinutes(
  estimatedMinutes: number | null,
  factor: number,
  defaultEstimatedMinutes = 30,
): number {
  const baseline = estimatedMinutes ?? defaultEstimatedMinutes;
  const safeBaseline = Number.isFinite(baseline) && baseline > 0 ? baseline : 30;
  return Math.max(5, Math.ceil((safeBaseline * factor) / 5) * 5);
}
