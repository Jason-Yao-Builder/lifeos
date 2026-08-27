import { compileAdaptivePlan } from './adaptive-planner.js';
import type { AdaptivePlanRequest, PlanViolationCode } from './adaptive-types.js';

export interface AdaptiveEvaluationCase {
  id: string;
  request: AdaptivePlanRequest;
  expected: {
    status: 'ready' | 'infeasible';
    assignedTaskIds?: readonly string[];
    violationCodes?: readonly PlanViolationCode[];
  };
}

export interface AdaptiveEvaluationResult {
  totalCases: number;
  passedCases: number;
  failedCaseIds: string[];
  scenarioPassRate: number;
  deterministicRate: number;
  hardConstraintViolationRate: number;
  unauthorizedOperationRate: number;
  dependencyOrderAccuracy: number;
  deadlineProtection: number;
  explanationCoverage: number;
  qualityGatePassed: boolean;
}

const average = (values: readonly number[], fallback = 1): number =>
  values.length === 0 ? fallback : values.reduce((sum, value) => sum + value, 0) / values.length;

export function evaluateAdaptivePlanner(
  cases: readonly AdaptiveEvaluationCase[],
): AdaptiveEvaluationResult {
  const results = cases.map((item) => {
    const proposal = compileAdaptivePlan(item.request);
    const repeated = compileAdaptivePlan(item.request);
    const expectedCodes = item.expected.violationCodes ?? [];
    const actualCodes = new Set(proposal.violations.map((violation) => violation.code));
    const expectedAssignments = item.expected.assignedTaskIds;
    const allowed = new Set(item.request.allowedTaskIds ?? item.request.tasks.map((task) => task.id));
    const unauthorized = [
      ...proposal.assignments.map((assignment) => assignment.taskId),
      ...proposal.deferredTaskIds,
    ].filter((taskId) => !allowed.has(taskId));
    const readyErrors = proposal.status === 'ready'
      ? proposal.violations.filter((violation) => violation.severity === 'error')
      : [];
    const passed =
      proposal.status === item.expected.status &&
      expectedCodes.every((code) => actualCodes.has(code)) &&
      (expectedAssignments === undefined ||
        JSON.stringify(proposal.assignments.map((assignment) => assignment.taskId)) ===
          JSON.stringify(expectedAssignments)) &&
      unauthorized.length === 0 &&
      readyErrors.length === 0 &&
      proposal.metrics.dependencyOrderAccuracy === 1 &&
      proposal.metrics.explanationCoverage === 1 &&
      (proposal.status !== 'ready' || proposal.metrics.hardDeadlineProtection === 1);
    return {
      id: item.id,
      proposal,
      passed,
      deterministic: JSON.stringify(proposal) === JSON.stringify(repeated),
      unauthorizedCount: unauthorized.length,
      readyErrorCount: readyErrors.length,
    };
  });
  const assignmentCount = results.reduce(
    (sum, item) => sum + item.proposal.assignments.length + item.proposal.deferredTaskIds.length,
    0,
  );
  const unauthorizedCount = results.reduce((sum, item) => sum + item.unauthorizedCount, 0);
  const readyErrorCount = results.reduce((sum, item) => sum + item.readyErrorCount, 0);
  const ready = results.filter((item) => item.proposal.status === 'ready');
  const passedCases = results.filter((item) => item.passed).length;
  const metrics = {
    scenarioPassRate: cases.length === 0 ? 0 : passedCases / cases.length,
    deterministicRate: cases.length === 0
      ? 0
      : results.filter((item) => item.deterministic).length / cases.length,
    hardConstraintViolationRate: ready.length === 0 ? 0 : readyErrorCount / ready.length,
    unauthorizedOperationRate: assignmentCount === 0 ? 0 : unauthorizedCount / assignmentCount,
    dependencyOrderAccuracy: average(ready.map((item) => item.proposal.metrics.dependencyOrderAccuracy)),
    deadlineProtection: average(ready.map((item) => item.proposal.metrics.hardDeadlineProtection)),
    explanationCoverage: average(results.map((item) => item.proposal.metrics.explanationCoverage)),
  };
  return {
    totalCases: cases.length,
    passedCases,
    failedCaseIds: results.filter((item) => !item.passed).map((item) => item.id),
    ...metrics,
    qualityGatePassed:
      metrics.scenarioPassRate >= 0.95 &&
      metrics.deterministicRate === 1 &&
      metrics.hardConstraintViolationRate === 0 &&
      metrics.unauthorizedOperationRate === 0 &&
      metrics.dependencyOrderAccuracy === 1 &&
      metrics.deadlineProtection >= 0.99 &&
      metrics.explanationCoverage >= 0.99,
  };
}
