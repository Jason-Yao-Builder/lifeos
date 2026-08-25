import type { TaskRecord } from '@lifeos/contracts';
import {
  DomainValidationError,
  InvalidTransitionError,
  assertValidTaskInput,
  calculateTaskScore,
  canTransitionTaskStatus,
  validateUpdateTaskInput,
} from '@lifeos/domain';
import type { FastifyPluginAsync } from 'fastify';
import {
  IdParamsSchema,
  AiTaskScoreSchema,
  ReorderBodySchema,
  RollForwardDeadlinesBodySchema,
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
  taskWasManuallyScored,
} from '../http.js';

export function taskRoutes(
  dependencies: Required<Pick<AppDependencies, 'store' | 'ai' | 'tenantId' | 'userId' | 'now'>>,
  timeZone: string,
) {
  const plugin: FastifyPluginAsync = async (app) => {
    app.get('/tasks', { schema: docs('List tasks', ['tasks']) }, async (request) => {
      const query = parseWith(TaskListQuerySchema, request.query);
      const tasks = await dependencies.store.tasks.list({
        ...omitUndefined(query),
        tenantId: dependencies.tenantId,
      });
      return {
        items: tasks.map((task) =>
          projectTask(
            task,
            dependencies.store.dependencies.isBlocked(dependencies.tenantId, task.id),
          ),
        ),
      };
    });

    app.post('/tasks', { schema: docs('Create a task', ['tasks']) }, async (request, reply) => {
      const input = assertValidTaskInput(normalizeTaskDeadline(request.body, timeZone));
      const manualScore = input.scoreDimensions ? calculateTaskScore(input.scoreDimensions).score : null;
      const created = await dependencies.store.tasks.create(
        {
          ...input,
          tenantId: dependencies.tenantId,
          ownerId: dependencies.userId,
          score: manualScore,
        },
        actorFor(request),
      );
      const task = input.scoreDimensions
        ? created
        : await scoreWithoutBlocking(dependencies, created, request.id);
      return reply.status(201).send(projectTask(task, false));
    });

    app.post('/tasks/reorder', { schema: docs('Reorder tasks', ['tasks']) }, async (request) => {
      const body = parseWith(ReorderBodySchema, request.body);
      const tasks = await dependencies.store.tasks.reorder(
        dependencies.tenantId,
        body.orderedIds,
        actorFor(request),
      );
      return {
        items: tasks.map((task) =>
          projectTask(
            task,
            dependencies.store.dependencies.isBlocked(dependencies.tenantId, task.id),
          ),
        ),
      };
    });

    app.post('/tasks/deadlines/roll-forward', { schema: docs('Roll overdue deadlines forward', ['tasks']) }, async (request) => {
      const body = parseWith(RollForwardDeadlinesBodySchema, request.body);
      const today = localDate(dependencies.now().toISOString(), timeZone);
      if (body.targetDate < today) {
        throw new DomainValidationError('顺延日期不能早于今天', [
          { path: 'targetDate', message: '请选择今天或未来日期', code: 'invalid_date' },
        ]);
      }
      const deadline = zonedDateTime(body.targetDate, '23:59:59', timeZone);
      const items = dependencies.store.transaction((store) => body.tasks.map(({ id, version }) => {
        const task = store.tasks.get(dependencies.tenantId, id);
        if (!task) throw new ResourceNotFoundError('task', id);
        const deadlineDate = task.deadline ? localDate(task.deadline, timeZone) : null;
        const targetDate = deadlineDate ?? task.plannedDate;
        if (!['todo', 'in_progress'].includes(task.status) || !targetDate || targetDate >= today) {
          throw new DomainValidationError('仅可顺延仍处于逾期状态的未完成任务', [
            { path: `tasks.${id}`, message: '任务已不再逾期或已结束', code: 'invalid_task' },
          ]);
        }
        return store.tasks.update(
          dependencies.tenantId,
          id,
          version,
          task.deadline ? { deadline } : { plannedDate: body.targetDate },
          actorFor(request),
        );
      }));
      const scoredItems = await Promise.all(items.map((task) =>
        taskWasManuallyScored(dependencies.store, dependencies.tenantId, task.id)
          ? task
          : scoreWithoutBlocking(dependencies, task, request.id),
      ));
      return {
        items: scoredItems.map((task) => projectTask(
          task,
          dependencies.store.dependencies.isBlocked(dependencies.tenantId, task.id),
        )),
      };
    });

    app.get('/tasks/:id', { schema: docs('Get a task', ['tasks']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const task = await dependencies.store.tasks.get(dependencies.tenantId, id);
      if (!task) throw new ResourceNotFoundError('task', id);
      return projectTask(
        task,
        dependencies.store.dependencies.isBlocked(dependencies.tenantId, task.id),
      );
    });

    app.patch('/tasks/:id', { schema: docs('Update a task', ['tasks']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const { version, patch } = parseWith(TaskPatchBodySchema, normalizePatchDeadline(request.body, timeZone));
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
      const validatedPatch = omitUndefined(validation.data);
      const persistedPatch = validation.data.scoreDimensions
        ? {
            ...validatedPatch,
            scoreDimensions: validation.data.scoreDimensions,
            score: calculateTaskScore(validation.data.scoreDimensions).score,
          }
        : validatedPatch;
      let updated = await dependencies.store.tasks.update(
        dependencies.tenantId,
        id,
        version,
        persistedPatch,
        actorFor(request),
      );
      if (
        ['temperature', 'deadline', 'estimatedMinutes'].some((field) => field in patch) &&
        !taskWasManuallyScored(dependencies.store, dependencies.tenantId, id)
      ) {
        updated = await scoreWithoutBlocking(dependencies, updated, request.id);
      }
      return projectTask(
        updated,
        dependencies.store.dependencies.isBlocked(dependencies.tenantId, updated.id),
      );
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

function normalizeDeadlineValue(value: unknown, timeZone: string): unknown {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? zonedDateTime(value, '23:59:59', timeZone)
    : value;
}

function normalizeTaskDeadline(input: unknown, timeZone: string): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  return 'deadline' in record
    ? { ...record, deadline: normalizeDeadlineValue(record.deadline, timeZone) }
    : record;
}

function normalizePatchDeadline(input: unknown, timeZone: string): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  if (!record.patch || typeof record.patch !== 'object' || Array.isArray(record.patch)) return record;
  return { ...record, patch: normalizeTaskDeadline(record.patch, timeZone) };
}

function localDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function zonedDateTime(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute, second] = time.split(':').map(Number) as [number, number, number];
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  let instant = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = formatter.formatToParts(new Date(instant));
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((item) => item.type === type)?.value);
    const rendered = Date.UTC(
      value('year'),
      value('month') - 1,
      value('day'),
      value('hour'),
      value('minute'),
      value('second'),
    );
    const correction = target - rendered;
    instant += correction;
    if (correction === 0) break;
  }
  const offsetMinutes = Math.round((target - instant) / 60_000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
  return `${date}T${time}${offset}`;
}

function projectTaskEvent(event: EventRecord) {
  const before = asRecord(event.before);
  const after = asRecord(event.after);
  const actor =
    event.actorType === 'human'
      ? ('user' as const)
      : event.actorType === 'system'
        ? ('rule' as const)
        : event.actorType;
  if (event.type === 'task.image.added' || event.type === 'task.image.deleted') {
    const added = event.type === 'task.image.added';
    const metadata = added ? after : before;
    const fileName = typeof metadata.fileName === 'string' ? metadata.fileName : null;
    const action = added ? '添加图片' : '删除图片';
    return [{
      id: event.id,
      taskId: event.aggregateId,
      field: 'image',
      oldValue: added ? null : fileName,
      newValue: added ? fileName : null,
      actor,
      summary: fileName ? `${action}「${fileName}」` : action,
      createdAt: event.createdAt,
    }];
  }
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
    actor,
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
