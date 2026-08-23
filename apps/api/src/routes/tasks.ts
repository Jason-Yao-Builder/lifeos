import type { TaskRecord } from '@lifeos/contracts';
import {
  DomainValidationError,
  InvalidTransitionError,
  assertValidTaskInput,
  canTransitionTaskStatus,
  validateUpdateTaskInput,
} from '@lifeos/domain';
import type { FastifyPluginAsync } from 'fastify';
import {
  IdParamsSchema,
  AiTaskScoreSchema,
  ReorderBodySchema,
  TaskDeleteQuerySchema,
  TaskListQuerySchema,
  TaskPatchBodySchema,
} from '../schemas.js';
import type { AppDependencies, EventRecord } from '../services.js';
import {
  ResourceNotFoundError,
  actorFor,
  docs,
  omitUndefined,
  parseWith,
  projectTask,
} from '../http.js';

export function taskRoutes(
  dependencies: Required<Pick<AppDependencies, 'store' | 'ai' | 'tenantId'>>,
) {
  const plugin: FastifyPluginAsync = async (app) => {
    app.get('/tasks', { schema: docs('List tasks', ['tasks']) }, async (request) => {
      const query = parseWith(TaskListQuerySchema, request.query);
      const tasks = await dependencies.store.tasks.list({
        ...omitUndefined(query),
        tenantId: dependencies.tenantId,
      });
      return { items: tasks.map(projectTask) };
    });

    app.post('/tasks', { schema: docs('Create a task', ['tasks']) }, async (request, reply) => {
      const input = assertValidTaskInput(normalizeTaskDeadline(request.body));
      const created = await dependencies.store.tasks.create(input, actorFor(request));
      const task = await scoreWithoutBlocking(dependencies, created, request.id);
      return reply.status(201).send(projectTask(task));
    });

    app.post('/tasks/reorder', { schema: docs('Reorder tasks', ['tasks']) }, async (request) => {
      const body = parseWith(ReorderBodySchema, request.body);
      const tasks = await dependencies.store.tasks.reorder(
        dependencies.tenantId,
        body.orderedIds,
        actorFor(request),
      );
      return { items: tasks.map(projectTask) };
    });

    app.get('/tasks/:id', { schema: docs('Get a task', ['tasks']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const task = await dependencies.store.tasks.get(dependencies.tenantId, id);
      if (!task) throw new ResourceNotFoundError('task', id);
      return projectTask(task);
    });

    app.patch('/tasks/:id', { schema: docs('Update a task', ['tasks']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const { version, patch } = parseWith(TaskPatchBodySchema, normalizePatchDeadline(request.body));
      const current = await dependencies.store.tasks.get(dependencies.tenantId, id);
      if (!current) throw new ResourceNotFoundError('task', id);

      const validation = validateUpdateTaskInput(patch, current);
      if (!validation.success) {
        throw new DomainValidationError('Invalid task update', validation.issues);
      }
      if (
        patch.status !== undefined &&
        patch.status !== current.status &&
        !canTransitionTaskStatus(current.status, patch.status)
      ) {
        throw new InvalidTransitionError('task', current.status, patch.status);
      }
      let updated = await dependencies.store.tasks.update(
        dependencies.tenantId,
        id,
        version,
        omitUndefined(validation.data),
        actorFor(request),
      );
      if (['temperature', 'deadline', 'estimatedMinutes'].some((field) => field in patch)) {
        updated = await scoreWithoutBlocking(dependencies, updated, request.id);
      }
      return projectTask(updated);
    });

    app.delete('/tasks/:id', { schema: docs('Delete or archive a task', ['tasks']) }, async (request, reply) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const { version } = parseWith(TaskDeleteQuerySchema, request.query);
      await dependencies.store.tasks.softDelete(
        dependencies.tenantId,
        id,
        version,
        actorFor(request),
      );
      return reply.status(204).send();
    });

    app.get('/tasks/:id/events', { schema: docs('List task events', ['events']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const events = dependencies.store.tasks.events(dependencies.tenantId, id);
      if (events.length === 0) throw new ResourceNotFoundError('task', id);
      return { items: events.flatMap(projectTaskEvent) };
    });
  };
  return plugin;
}

function normalizeDeadlineValue(value: unknown): unknown {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T23:59:59+08:00`
    : value;
}

function normalizeTaskDeadline(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  return 'deadline' in record
    ? { ...record, deadline: normalizeDeadlineValue(record.deadline) }
    : record;
}

function normalizePatchDeadline(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  if (!record.patch || typeof record.patch !== 'object' || Array.isArray(record.patch)) return record;
  return { ...record, patch: normalizeTaskDeadline(record.patch) };
}

function projectTaskEvent(event: EventRecord) {
  const before = asRecord(event.before);
  const after = asRecord(event.after);
  const ignored = new Set(['updatedAt', 'version']);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (field) => !ignored.has(field) && JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
  const fields = changed.length > 0 ? changed : [event.type.split('.').at(-1) ?? 'change'];
  return fields.map((field, index) => ({
    id: fields.length === 1 ? event.id : `${event.id}:${index}`,
    taskId: event.aggregateId,
    field,
    oldValue: before[field] ?? null,
    newValue: after[field] ?? null,
    actor:
      event.actorType === 'human'
        ? ('user' as const)
        : event.actorType === 'system'
          ? ('rule' as const)
          : event.actorType,
    summary: `${event.type}: ${field}`,
    createdAt: event.createdAt,
  }));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function scoreWithoutBlocking(
  dependencies: Required<Pick<AppDependencies, 'store' | 'ai' | 'tenantId'>>,
  task: TaskRecord,
  correlationId: string,
) {
  try {
    const [candidate] = await dependencies.ai.scoreTasks([task]);
    const parsed = AiTaskScoreSchema.safeParse(candidate);
    if (!parsed.success) return task;
    const result = parsed.data;
    if (result.taskId !== task.id) return task;
    return dependencies.store.tasks.update(
      dependencies.tenantId,
      task.id,
      task.version,
      { scoreDimensions: result.dimensions, score: result.score },
      { type: 'ai', correlationId },
    );
  } catch {
    return task;
  }
}
