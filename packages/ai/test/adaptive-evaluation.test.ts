import { describe, expect, it } from 'vitest';
import { evaluateAdaptivePlanner } from '../src/index.js';
import { adaptiveEvaluationCases } from './fixtures/adaptive-cases.js';

describe('adaptive scheduling quality gate', () => {
  it('passes the safety, feasibility, stability, and explanation gates', () => {
    const result = evaluateAdaptivePlanner(adaptiveEvaluationCases);

    expect(result.failedCaseIds).toEqual([]);
    expect(result.totalCases).toBeGreaterThanOrEqual(13);
    expect(result.scenarioPassRate).toBe(1);
    expect(result.deterministicRate).toBe(1);
    expect(result.hardConstraintViolationRate).toBe(0);
    expect(result.unauthorizedOperationRate).toBe(0);
    expect(result.dependencyOrderAccuracy).toBe(1);
    expect(result.deadlineProtection).toBe(1);
    expect(result.explanationCoverage).toBe(1);
    expect(result.qualityGatePassed).toBe(true);
  });
});
