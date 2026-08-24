import {
  ApiErrorSchema,
  TaskDtoSchema,
  TaskRecordSchema,
  TaskScoreDimensionsSchema,
  type TaskDto,
  type TaskRecord,
  type TaskScoreDimensions,
} from '@lifeos/contracts';
import { DomainValidationError, InvalidTransitionError, getTaskHardness } from '@lifeos/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ZodError, type ZodType } from 'zod';
import type { ActorInput, ApiStore } from './services.js';

export function parseWith<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

export function omitUndefined<T extends object>(value: T): {
  [Key in keyof T]?: Exclude<T[Key], undefined>;
} {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as {
    [Key in keyof T]?: Exclude<T[Key], undefined>;
  };
}

export function projectTask(value: unknown, isBlocked = false): TaskDto {
  const task = TaskRecordSchema.parse(value);
  return TaskDtoSchema.parse({ ...task, hardness: getTaskHardness(task), isBlocked });
}

export function taskWasManuallyScored(
  store: ApiStore,
  tenantId: string,
  taskId: string,
): boolean {
  return store.tasks.events(tenantId, taskId).some((event) => {
    if (event.actorType !== 'human') return false;
    const after = scoreDimensionsFrom(event.after);
    if (!after) return false;
    if (event.type === 'task.created') return true;
    if (event.type !== 'task.updated') return false;
    return !sameScoreDimensions(scoreDimensionsFrom(event.before), after);
  });
}

function scoreDimensionsFrom(value: unknown): TaskScoreDimensions | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const parsed = TaskScoreDimensionsSchema.safeParse(
    (value as Record<string, unknown>).scoreDimensions,
  );
  return parsed.success ? parsed.data : null;
}

function sameScoreDimensions(
  left: TaskScoreDimensions | null,
  right: TaskScoreDimensions,
): boolean {
  return left !== null &&
    left.impact === right.impact &&
    left.urgency === right.urgency &&
    left.alignment === right.alignment &&
    left.effort === right.effort;
}

export function tasksForAiContext(
  store: ApiStore,
  tenantId: string,
  tasks: TaskRecord[],
): TaskRecord[] {
  return tasks.map((task) =>
    taskWasManuallyScored(store, tenantId, task.id)
      ? task
      : { ...task, scoreDimensions: null, score: null },
  );
}

export function actorFor(request: FastifyRequest, type: ActorInput['type'] = 'human'): ActorInput {
  return { type, correlationId: request.id };
}

export class ResourceNotFoundError extends Error {
  readonly code = 'NOT_FOUND';

  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = 'ResourceNotFoundError';
  }
}

function classifyError(error: unknown): {
  status: number;
  code:
    | 'VALIDATION_ERROR'
    | 'NOT_FOUND'
    | 'CONFLICT'
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'AI_UNAVAILABLE'
    | 'INTERNAL_ERROR';
  message: string;
  details?: Array<{ path: string; message: string; code?: string }>;
} {
  if (error instanceof ZodError) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
        code: issue.code,
      })),
    };
  }
  if (error instanceof DomainValidationError) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: error.message,
      details: error.issues.map((issue) => ({ ...issue })),
    };
  }
  if (error instanceof InvalidTransitionError) {
    return { status: 409, code: 'CONFLICT', message: error.message };
  }

  const candidate = error as { code?: string; message?: string; statusCode?: number };
  if (candidate.code === 'NOT_FOUND' || candidate.statusCode === 404) {
    return { status: 404, code: 'NOT_FOUND', message: candidate.message ?? 'Resource not found' };
  }
  if (candidate.statusCode === 413) {
    return { status: 413, code: 'VALIDATION_ERROR', message: 'Request body too large' };
  }
  if (candidate.code === 'VERSION_CONFLICT') {
    return { status: 409, code: 'CONFLICT', message: candidate.message ?? 'Version conflict' };
  }
  if (candidate.code === 'DEPENDENCY_CYCLE') {
    return { status: 409, code: 'CONFLICT', message: candidate.message ?? 'Circular dependency' };
  }
  if (candidate.code === 'AI_RUN_IN_PROGRESS') {
    return { status: 409, code: 'CONFLICT', message: 'AI_RUN_IN_PROGRESS' };
  }
  if (candidate.code === 'INVALID_MUTATION') {
    return { status: 400, code: 'VALIDATION_ERROR', message: candidate.message ?? 'Invalid mutation' };
  }
  if (candidate.code === 'UNAUTHORIZED') {
    return { status: 401, code: 'UNAUTHORIZED', message: candidate.message ?? 'Unauthorized' };
  }
  if (candidate.code === 'AI_UNAVAILABLE') {
    return { status: 503, code: 'AI_UNAVAILABLE', message: candidate.message ?? 'AI unavailable' };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
}

export function installErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const classified = classifyError(error);
    const body = {
      error: {
        code: classified.code,
        message: classified.message,
        ...(classified.details ? { details: classified.details } : {}),
        correlationId: request.id,
      },
    };
    reply.status(classified.status).send(ApiErrorSchema.parse(body));
  });
}

export const docs = (summary: string, tags: string[]) => ({ summary, tags });
