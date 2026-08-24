import {
  CreateSubtaskInputSchema,
  DependencyTypeSchema,
  EntityIdSchema,
  LocalDateSchema,
} from '@lifeos/contracts';
import { calculateTaskScore } from '@lifeos/domain';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { actorFor, docs, parseWith, projectTask, ResourceNotFoundError } from '../http.js';
import { IdParamsSchema, ReorderBodySchema } from '../schemas.js';
import type { AppDependencies } from '../services.js';

const DependencyBodySchema = z
  .object({ predecessorId: EntityIdSchema, type: DependencyTypeSchema.default('finish_to_start') })
  .strict();
const DependencyParamsSchema = z
  .object({ id: EntityIdSchema, dependencyId: EntityIdSchema })
  .strict();
const CriticalPathQuerySchema = z
  .object({ from: LocalDateSchema.optional(), to: LocalDateSchema.optional(), goalId: EntityIdSchema.optional() })
  .strict();

export function taskStructureRoutes(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId' | 'userId'>>,
) {
  const plugin: FastifyPluginAsync = async (app) => {
    app.get('/tasks/critical-path', { schema: docs('Calculate the critical path', ['dependencies']) }, async (request) => {
      const query = parseWith(CriticalPathQuerySchema, request.query);
      const tasks =
        query.from && query.to
          ? dependencies.store.tasks.listGantt({
              tenantId: dependencies.tenantId,
              start: query.from,
              end: query.to,
              ...(query.goalId ? { goalId: query.goalId } : {}),
            })
          : dependencies.store.tasks.list({
              tenantId: dependencies.tenantId,
              ...(query.goalId ? { goalId: query.goalId } : {}),
              limit: 500,
            });
      return {
        taskIds: dependencies.store.dependencies.criticalPath(
          dependencies.tenantId,
          tasks.map((task) => task.id),
        ),
      };
    });

    app.get('/tasks/:id/dependencies', { schema: docs('List task dependencies', ['dependencies']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      ensureTask(dependencies, id);
      return {
        ...dependencies.store.dependencies.listForTask(dependencies.tenantId, id),
        isBlocked: dependencies.store.dependencies.isBlocked(dependencies.tenantId, id),
      };
    });

    app.post('/tasks/:id/dependencies', { schema: docs('Create a task dependency', ['dependencies']) }, async (request, reply) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const body = parseWith(DependencyBodySchema, request.body);
      ensureTask(dependencies, id);
      ensureTask(dependencies, body.predecessorId);
      const dependency = dependencies.store.dependencies.create(
        {
          tenantId: dependencies.tenantId,
          predecessorId: body.predecessorId,
          successorId: id,
          type: body.type,
        },
        actorFor(request),
      );
      return reply.status(201).send(dependency);
    });

    app.delete('/tasks/:id/dependencies/:dependencyId', { schema: docs('Remove a task dependency', ['dependencies']) }, async (request, reply) => {
      const { id, dependencyId } = parseWith(DependencyParamsSchema, request.params);
      const listed = dependencies.store.dependencies.listForTask(dependencies.tenantId, id);
      if (![...listed.predecessors, ...listed.successors].some((item) => item.id === dependencyId)) {
        throw new ResourceNotFoundError('dependency', dependencyId);
      }
      dependencies.store.dependencies.remove(dependencies.tenantId, dependencyId, actorFor(request));
      return reply.status(204).send();
    });

    app.get('/tasks/:id/subtasks', { schema: docs('List subtasks', ['tasks']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      ensureTask(dependencies, id);
      return {
        items: dependencies.store.tasks.listSubtasks(dependencies.tenantId, id).map((task) =>
          projectTask(task, dependencies.store.dependencies.isBlocked(dependencies.tenantId, task.id)),
        ),
      };
    });

    app.post('/tasks/:id/subtasks/reorder', { schema: docs('Reorder direct subtasks', ['tasks']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const { orderedIds } = parseWith(ReorderBodySchema, request.body);
      const reordered = dependencies.store.tasks.reorderSubtasks(
        dependencies.tenantId,
        id,
        orderedIds,
        actorFor(request),
      );
      return {
        items: reordered.map((task) =>
          projectTask(
            task,
            dependencies.store.dependencies.isBlocked(dependencies.tenantId, task.id),
          ),
        ),
      };
    });

    app.post('/tasks/:id/subtasks', { schema: docs('Create a subtask', ['tasks']) }, async (request, reply) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const parent = ensureTask(dependencies, id);
      const input = parseWith(CreateSubtaskInputSchema, request.body);
      const score = input.scoreDimensions ? calculateTaskScore(input.scoreDimensions).score : null;
      const task = dependencies.store.tasks.create(
        {
          ...input,
          tenantId: dependencies.tenantId,
          ownerId: dependencies.userId,
          parentTaskId: id,
          goalId: input.goalId ?? parent.goalId,
          tags: [...parent.tags],
          status: parent.status,
          score,
        },
        actorFor(request),
      );
      return reply.status(201).send(projectTask(task, false));
    });

    app.get('/tasks/:id/progress', { schema: docs('Get subtask progress', ['tasks']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      ensureTask(dependencies, id);
      return dependencies.store.tasks.progress(dependencies.tenantId, id);
    });
  };
  return plugin;
}

function ensureTask(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId'>>,
  id: string,
) {
  const task = dependencies.store.tasks.get(dependencies.tenantId, id);
  if (!task) throw new ResourceNotFoundError('task', id);
  return task;
}
