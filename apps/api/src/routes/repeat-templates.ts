import {
  CreateRepeatTemplateInputSchema,
  LocalDateSchema,
  UpdateRepeatTemplateInputSchema,
} from '@lifeos/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  actorFor,
  docs,
  omitUndefined,
  parseWith,
  projectTask,
  ResourceNotFoundError,
} from '../http.js';
import { IdParamsSchema } from '../schemas.js';
import type { AppDependencies } from '../services.js';

const RepeatListQuerySchema = z
  .object({ enabled: z.enum(['true', 'false']).transform((value) => value === 'true').optional() })
  .strict();
const GenerateBodySchema = z.object({ throughDate: LocalDateSchema.optional() }).strict();

export function repeatTemplateRoutes(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId' | 'userId'>>,
) {
  const plugin: FastifyPluginAsync = async (app) => {
    app.get('/repeat-templates', { schema: docs('List repeat templates', ['repeat-templates']) }, async (request) => {
      const query = parseWith(RepeatListQuerySchema, request.query);
      return {
        items: dependencies.store.repeatTemplates.list({
          tenantId: dependencies.tenantId,
          ...omitUndefined(query),
        }),
      };
    });

    app.post('/repeat-templates', { schema: docs('Create a repeat template', ['repeat-templates']) }, async (request, reply) => {
      const input = parseWith(CreateRepeatTemplateInputSchema, request.body);
      const template = dependencies.store.repeatTemplates.create(
        { ...input, tenantId: dependencies.tenantId, ownerId: dependencies.userId },
        actorFor(request),
      );
      return reply.status(201).send(template);
    });

    app.get('/repeat-templates/:id', { schema: docs('Get a repeat template', ['repeat-templates']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      return ensureTemplate(dependencies, id);
    });

    app.patch('/repeat-templates/:id', { schema: docs('Update a repeat template', ['repeat-templates']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      ensureTemplate(dependencies, id);
      const patch = parseWith(UpdateRepeatTemplateInputSchema, request.body);
      return dependencies.store.repeatTemplates.update(
        dependencies.tenantId,
        id,
        omitUndefined(patch),
        actorFor(request),
      );
    });

    app.delete('/repeat-templates/:id', { schema: docs('Disable a repeat template', ['repeat-templates']) }, async (request, reply) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      ensureTemplate(dependencies, id);
      dependencies.store.repeatTemplates.softDelete(dependencies.tenantId, id, actorFor(request));
      return reply.status(204).send();
    });

    app.post('/repeat-templates/:id/generate', { schema: docs('Generate repeat task instances', ['repeat-templates']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      ensureTemplate(dependencies, id);
      const body = parseWith(GenerateBodySchema, request.body ?? {});
      const generation = dependencies.store.repeatTemplates.generate(
        dependencies.tenantId,
        id,
        omitUndefined(body),
        actorFor(request, 'system'),
      );
      return { ...generation, items: generation.tasks.map((task) => projectTask(task, false)) };
    });

    app.post('/repeat-templates/generate-all', { schema: docs('Generate all repeat task instances', ['repeat-templates']) }, async (request) => {
      const body = parseWith(GenerateBodySchema, request.body ?? {});
      const generations = dependencies.store.repeatTemplates.generateAll(
        dependencies.tenantId,
        omitUndefined(body),
        actorFor(request, 'system'),
      );
      return {
        generations,
        items: generations.flatMap((generation) =>
          generation.tasks.map((task) => projectTask(task, false)),
        ),
      };
    });
  };
  return plugin;
}

function ensureTemplate(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId'>>,
  id: string,
) {
  const template = dependencies.store.repeatTemplates.get(dependencies.tenantId, id);
  if (!template) throw new ResourceNotFoundError('repeat template', id);
  return template;
}
