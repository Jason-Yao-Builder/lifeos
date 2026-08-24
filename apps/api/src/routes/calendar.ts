import {
  CalendarResponseSchema,
  CalendarViewSchema,
  EntityIdSchema,
  LocalDateSchema,
  RescheduleTaskInputSchema,
} from '@lifeos/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { actorFor, docs, parseWith, projectTask, ResourceNotFoundError } from '../http.js';
import { IdParamsSchema } from '../schemas.js';
import type { AppDependencies } from '../services.js';

const CalendarQuerySchema = z
  .object({
    start: LocalDateSchema,
    end: LocalDateSchema,
    view: CalendarViewSchema.default('month'),
    goalId: EntityIdSchema.optional(),
  })
  .strict()
  .refine((value) => value.start <= value.end, { message: 'start must not be after end' });

export function calendarRoutes(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId'>>,
  timeZone: string,
) {
  const plugin: FastifyPluginAsync = async (app) => {
    app.get('/calendar', { schema: docs('Get calendar data', ['calendar']) }, async (request) => {
      const query = parseWith(CalendarQuerySchema, request.query);
      const tasks = dependencies.store.tasks.listCalendar({
        tenantId: dependencies.tenantId,
        start: query.start,
        end: query.end,
        ...(query.goalId ? { goalId: query.goalId } : {}),
      });
      const days: Record<string, { tasks: unknown[]; deadlineTasks: unknown[]; repeatTasks: unknown[] }> = {};
      const day = (date: string) =>
        (days[date] ??= { tasks: [], deadlineTasks: [], repeatTasks: [] });
      for (const task of tasks) {
        const dto = projectTask(
          task,
          dependencies.store.dependencies.isBlocked(dependencies.tenantId, task.id),
        );
        if (task.plannedDate && task.plannedDate >= query.start && task.plannedDate <= query.end) {
          day(task.plannedDate).tasks.push(dto);
          if (task.repeatTemplateId) day(task.plannedDate).repeatTasks.push(dto);
        }
        if (task.deadline) {
          const deadlineDate = localDate(task.deadline, timeZone);
          if (deadlineDate >= query.start && deadlineDate <= query.end) {
            day(deadlineDate).deadlineTasks.push(dto);
          }
        }
      }
      return CalendarResponseSchema.parse({ days });
    });

    app.patch('/tasks/:id/reschedule', { schema: docs('Reschedule a task', ['calendar']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const input = parseWith(RescheduleTaskInputSchema, request.body);
      if (!dependencies.store.tasks.get(dependencies.tenantId, id)) {
        throw new ResourceNotFoundError('task', id);
      }
      const updated = dependencies.store.tasks.update(
        dependencies.tenantId,
        id,
        input.version,
        {
          plannedDate: input.plannedDate,
          ...(input.startsAt !== undefined ? { startAt: input.startsAt } : {}),
          ...(input.endsAt !== undefined ? { endAt: input.endsAt } : {}),
        },
        actorFor(request),
      );
      return projectTask(
        updated,
        dependencies.store.dependencies.isBlocked(dependencies.tenantId, id),
      );
    });
  };
  return plugin;
}

function localDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}
