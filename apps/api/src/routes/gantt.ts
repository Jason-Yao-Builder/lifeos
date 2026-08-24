import {
  EntityIdSchema,
  GanttResponseSchema,
  LocalDateSchema,
  TaskTimespanInputSchema,
} from '@lifeos/contracts';
import type { TaskRecord } from '@lifeos/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { actorFor, docs, parseWith, projectTask, ResourceNotFoundError } from '../http.js';
import { IdParamsSchema } from '../schemas.js';
import type { AppDependencies } from '../services.js';

const GanttQuerySchema = z
  .object({ start: LocalDateSchema, end: LocalDateSchema, goalId: EntityIdSchema.optional() })
  .strict()
  .refine((value) => value.start <= value.end, { message: 'start must not be after end' });

export function ganttRoutes(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId'>>,
  timeZone: string,
) {
  const plugin: FastifyPluginAsync = async (app) => {
    app.get('/gantt', { schema: docs('Get Gantt data', ['gantt']) }, async (request) => {
      const query = parseWith(GanttQuerySchema, request.query);
      const candidates = dependencies.store.tasks.listGantt({
        tenantId: dependencies.tenantId,
        start: query.start,
        end: query.end,
        ...(query.goalId ? { goalId: query.goalId } : {}),
      });
      const records = candidates.filter((task) =>
        taskOverlapsRange(task, query.start, query.end, timeZone),
      );
      const ids = new Set(records.map((task) => task.id));
      const dependenciesById = new Map();
      for (const task of records) {
        const related = dependencies.store.dependencies.listForTask(dependencies.tenantId, task.id);
        for (const item of [...related.predecessors, ...related.successors]) {
          if (ids.has(item.predecessorId) && ids.has(item.successorId)) dependenciesById.set(item.id, item);
        }
      }
      const criticalPath = dependencies.store.dependencies.criticalPath(
        dependencies.tenantId,
        records.map((task) => task.id),
      );
      const tasks = records.map((task) => {
        const isBlocked = dependencies.store.dependencies.isBlocked(dependencies.tenantId, task.id);
        const childProgress = dependencies.store.tasks.progress(dependencies.tenantId, task.id);
        const { startsAt, endsAt } = taskTimespan(task, timeZone);
        const { startAt: _startAt, endAt: _endAt, ...dto } = projectTask(task, isBlocked);
        void _startAt;
        void _endAt;
        const completed = task.status === 'completed' || task.completedAt !== null;
        return {
          ...dto,
          startsAt,
          endsAt,
          progress:
            childProgress.total > 0
              ? childProgress
              : {
                  completed: completed ? 1 : 0,
                  total: 1,
                  percent: completed ? 100 : 0,
                },
        };
      });
      return GanttResponseSchema.parse({
        tasks,
        dependencies: [...dependenciesById.values()],
        criticalPath,
      });
    });

    app.patch('/tasks/:id/timespan', { schema: docs('Update a task timespan', ['gantt']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const input = parseWith(TaskTimespanInputSchema, request.body);
      if (!dependencies.store.tasks.get(dependencies.tenantId, id)) {
        throw new ResourceNotFoundError('task', id);
      }
      const task = dependencies.store.tasks.update(
        dependencies.tenantId,
        id,
        input.version,
        { startAt: input.startAt, endAt: input.endAt },
        actorFor(request),
      );
      return projectTask(
        task,
        dependencies.store.dependencies.isBlocked(dependencies.tenantId, id),
      );
    });
  };
  return plugin;
}

function taskOverlapsRange(
  task: TaskRecord,
  start: string,
  end: string,
  timeZone: string,
): boolean {
  const { startsAt, endsAt } = taskTimespan(task, timeZone);
  const rangeStart = Date.parse(dateStart(start, timeZone));
  const rangeEndExclusive = Date.parse(dateStart(addDays(end, 1), timeZone));
  return Date.parse(startsAt) < rangeEndExclusive && Date.parse(endsAt) >= rangeStart;
}

function taskTimespan(task: TaskRecord, timeZone: string): { startsAt: string; endsAt: string } {
  const fallbackDate = task.plannedDate ?? dateInTimeZone(task.createdAt, timeZone);
  return {
    startsAt: task.startAt ?? dateStart(fallbackDate, timeZone),
    endsAt: task.endAt ?? task.deadline ?? dateEnd(fallbackDate, timeZone),
  };
}

function dateInTimeZone(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function dateStart(date: string, timeZone: string): string {
  return zonedDateTime(date, '00:00:00', timeZone);
}

function dateEnd(date: string, timeZone: string): string {
  return zonedDateTime(date, '23:59:59', timeZone);
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
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
