import {
  CreateTaskInputSchema,
  UpdateTaskInputSchema,
  type CreateTaskInput,
  type Hardness,
  type TaskRecord,
  type UpdateTaskInput,
} from '@lifeos/contracts';
import { DomainValidationError, type DomainIssue } from './errors.js';

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; issues: readonly DomainIssue[] };

type TemporalFields = Pick<TaskRecord, 'startAt' | 'endAt' | 'deadline'>;

function temporalIssues(fields: TemporalFields): DomainIssue[] {
  if (!fields.startAt) return [];

  const issues: DomainIssue[] = [];
  const start = Date.parse(fields.startAt);
  if (fields.endAt && start > Date.parse(fields.endAt)) {
    issues.push({
      path: 'endAt',
      code: 'INVALID_TIME_RANGE',
      message: 'endAt must be at or after startAt',
    });
  }
  if (fields.deadline && start > Date.parse(fields.deadline)) {
    issues.push({
      path: 'deadline',
      code: 'INVALID_TIME_RANGE',
      message: 'deadline must be at or after startAt',
    });
  }
  return issues;
}

function schemaIssues(issues: readonly { path: readonly PropertyKey[]; message: string; code: string }[]) {
  return issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

export function validateCreateTaskInput(input: unknown): ValidationResult<CreateTaskInput> {
  const parsed = CreateTaskInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, issues: schemaIssues(parsed.error.issues) };

  const issues = temporalIssues(parsed.data);
  return issues.length > 0
    ? { success: false, issues }
    : { success: true, data: parsed.data };
}

export function assertValidCreateTaskInput(input: unknown): CreateTaskInput {
  const result = validateCreateTaskInput(input);
  if (!result.success) throw new DomainValidationError('Invalid task input', result.issues);
  return result.data;
}

export const assertValidTaskInput = assertValidCreateTaskInput;

export function validateUpdateTaskInput(
  input: unknown,
  current?: TemporalFields,
): ValidationResult<UpdateTaskInput> {
  const parsed = UpdateTaskInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, issues: schemaIssues(parsed.error.issues) };

  const temporal: TemporalFields = {
    startAt: 'startAt' in parsed.data ? (parsed.data.startAt ?? null) : (current?.startAt ?? null),
    endAt: 'endAt' in parsed.data ? (parsed.data.endAt ?? null) : (current?.endAt ?? null),
    deadline:
      'deadline' in parsed.data ? (parsed.data.deadline ?? null) : (current?.deadline ?? null),
  };
  const issues = temporalIssues(temporal);
  return issues.length > 0
    ? { success: false, issues }
    : { success: true, data: parsed.data };
}

export function getTaskHardness(task: Pick<TaskRecord, 'deadline'>): Hardness {
  return task.deadline === null ? 'soft' : 'hard';
}
