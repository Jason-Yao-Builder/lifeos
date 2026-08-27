import type { TaskRecord } from '@lifeos/contracts';

export type PlanTask = Pick<
  TaskRecord,
  | 'id'
  | 'title'
  | 'status'
  | 'deadline'
  | 'plannedDate'
  | 'estimatedMinutes'
  | 'actualMinutes'
  | 'goalId'
  | 'parentTaskId'
  | 'rank'
  | 'version'
  | 'createdAt'
  | 'deletedAt'
>;

export interface PlanDependency {
  predecessorId: string;
  successorId: string;
}

export interface AvailabilityWindow {
  id: string;
  start: string;
  end: string;
}

export interface DurationObservation {
  estimatedMinutes: number;
  actualMinutes: number;
}

export interface PreviousAssignment {
  taskId: string;
  start: string;
  end: string;
}

export interface AdaptivePlanRequest {
  now: string;
  tasks: readonly PlanTask[];
  dependencies: readonly PlanDependency[];
  windows: readonly AvailabilityWindow[];
  allowedTaskIds?: readonly string[];
  durationHistory?: readonly DurationObservation[];
  previousAssignments?: readonly PreviousAssignment[];
  freezeBefore?: string;
  defaultEstimatedMinutes?: number;
}

export type PlanReasonCode =
  | 'DEADLINE_AT_RISK'
  | 'DEPENDENCY_READY'
  | 'PREVIOUS_PLAN_PRESERVED'
  | 'GOAL_ALIGNED'
  | 'USER_ORDER'
  | 'FITS_WINDOW'
  | 'ESTIMATE_CALIBRATED';

export interface ScheduleAssignment {
  taskId: string;
  taskVersion: number;
  windowId: string;
  start: string;
  end: string;
  durationMinutes: number;
  reasonCodes: PlanReasonCode[];
  explanation: string;
}

export type PlanViolationCode =
  | 'DUPLICATE_TASK'
  | 'INVALID_NOW'
  | 'INVALID_WINDOW'
  | 'OVERLAPPING_WINDOWS'
  | 'MISSING_DEPENDENCY_TASK'
  | 'DEPENDENCY_CYCLE'
  | 'DEADLINE_MISSED'
  | 'DEPENDENCY_BLOCKED'
  | 'INVALID_LOCKED_ASSIGNMENT'
  | 'LOCKED_ASSIGNMENT_CONFLICT';

export interface PlanViolation {
  code: PlanViolationCode;
  severity: 'error' | 'warning';
  taskIds: string[];
  message: string;
}

export interface AdaptivePlanMetrics {
  activeTaskCount: number;
  scheduledTaskCount: number;
  capacityMinutes: number;
  scheduledMinutes: number;
  capacityUtilization: number;
  hardDeadlineProtection: number;
  dependencyOrderAccuracy: number;
  explanationCoverage: number;
  churnRate: number;
  durationCalibrationFactor: number;
}

export interface AdaptivePlanProposal {
  kind: 'adaptive-schedule';
  schemaVersion: 1;
  generatedAt: string;
  status: 'ready' | 'infeasible';
  assignments: ScheduleAssignment[];
  deferredTaskIds: string[];
  violations: PlanViolation[];
  metrics: AdaptivePlanMetrics;
  explanation: string;
}
