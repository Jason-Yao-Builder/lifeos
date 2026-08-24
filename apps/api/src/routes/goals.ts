import {
  CreateGoalInputSchema,
  GoalStatusSchema,
  UpdateGoalInputSchema,
} from '@lifeos/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { actorFor, docs, omitUndefined, parseWith, projectTask, ResourceNotFoundError } from '../http.js';
import { IdParamsSchema } from '../schemas.js';
import type { AppDependencies } from '../services.js';

const GoalListQuerySchema = z.object({ status: GoalStatusSchema.optional() }).strict();

export function goalRoutes(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId' | 'userId'>>,
) {
  const plugin: FastifyPluginAsync = async (app) => {
    app.get('/goals', { schema: docs('List goals', ['goals']) }, async (request) => {
      const query = parseWith(GoalListQuerySchema, request.query);
      return {
        items: dependencies.store.goals.list({
          tenantId: dependencies.tenantId,
          ...omitUndefined(query),
        }),
      };
    });

    app.post('/goals', { schema: docs('Create a goal', ['goals']) }, async (request, reply) => {
      const input = parseWith(CreateGoalInputSchema, request.body);
      const goal = dependencies.store.goals.create(
        { ...input, tenantId: dependencies.tenantId, ownerId: dependencies.userId },
        actorFor(request),
      );
      return reply.status(201).send(goal);
    });

    app.get('/goals/:id', { schema: docs('Get a goal', ['goals']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const goal = dependencies.store.goals.get(dependencies.tenantId, id);
      if (!goal) throw new ResourceNotFoundError('goal', id);
      return goal;
    });

    app.patch('/goals/:id', { schema: docs('Update a goal', ['goals']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const patch = parseWith(UpdateGoalInputSchema, request.body);
      return dependencies.store.goals.update(
        dependencies.tenantId,
        id,
        omitUndefined(patch),
        actorFor(request),
      );
    });

    app.delete('/goals/:id', { schema: docs('Archive a goal', ['goals']) }, async (request, reply) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      dependencies.store.goals.softDelete(dependencies.tenantId, id, actorFor(request));
      return reply.status(204).send();
    });

    app.get('/goals/:id/tasks', { schema: docs('List goal tasks', ['goals']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      ensureGoal(dependencies, id);
      return {
        items: dependencies.store.goals.tasks(dependencies.tenantId, id).map((task) =>
          projectTask(task, dependencies.store.dependencies.isBlocked(dependencies.tenantId, task.id)),
        ),
      };
    });

    app.get('/goals/:id/progress', { schema: docs('Get goal progress', ['goals']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      ensureGoal(dependencies, id);
      return dependencies.store.goals.progress(dependencies.tenantId, id);
    });
  };
  return plugin;
}

function ensureGoal(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId'>>,
  id: string,
): void {
  if (!dependencies.store.goals.get(dependencies.tenantId, id)) {
    throw new ResourceNotFoundError('goal', id);
  }
}
