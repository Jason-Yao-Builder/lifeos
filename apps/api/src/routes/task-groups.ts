import {
  CreateTaskGroupInputSchema,
  UpdateTaskGroupInputSchema,
} from '@lifeos/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { actorFor, docs, omitUndefined, parseWith } from '../http.js';
import { IdParamsSchema } from '../schemas.js';
import type { AppDependencies } from '../services.js';

export function taskGroupRoutes(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId'>>,
) {
  const plugin: FastifyPluginAsync = async (app) => {
    app.get('/task-groups', { schema: docs('List task groups', ['task-groups']) }, async () => ({
      items: dependencies.store.taskGroups.list(dependencies.tenantId),
    }));

    app.post('/task-groups', { schema: docs('Create a task group', ['task-groups']) }, async (request, reply) => {
      const input = parseWith(CreateTaskGroupInputSchema, request.body);
      const group = dependencies.store.taskGroups.create(
        { ...input, workspaceId: dependencies.tenantId },
        actorFor(request),
      );
      return reply.status(201).send(group);
    });

    app.patch('/task-groups/:id', { schema: docs('Update a task group', ['task-groups']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const patch = parseWith(UpdateTaskGroupInputSchema, request.body);
      return dependencies.store.taskGroups.update(
        dependencies.tenantId,
        id,
        omitUndefined(patch),
        actorFor(request),
      );
    });
  };
  return plugin;
}
