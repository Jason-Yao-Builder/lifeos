import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { docs, parseWith } from '../http.js';
import { DebugEventsQuerySchema } from '../schemas.js';
import type { AppDependencies } from '../services.js';

export interface DebugRouteOptions {
  apiKey?: string;
}

function authorize(request: FastifyRequest, apiKey?: string): void {
  if (!apiKey || request.headers['x-api-key'] === apiKey) return;
  const error = new Error('Invalid debug API key') as Error & { code: string };
  error.code = 'UNAUTHORIZED';
  throw error;
}

export function debugRoutes(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId' | 'now'>>,
  options: DebugRouteOptions,
) {
  const plugin: FastifyPluginAsync = async (app) => {
    app.addHook('preHandler', async (request) => authorize(request, options.apiKey));

    app.get('/health', { schema: docs('Health check', ['debug']) }, async () => {
      if (dependencies.store.debug) await dependencies.store.debug.stats(dependencies.tenantId);
      return { status: 'ok', database: 'ok', timestamp: dependencies.now().toISOString() };
    });

    app.get('/stats', { schema: docs('Runtime statistics', ['debug']) }, async () => {
      if (dependencies.store.debug) return dependencies.store.debug.stats(dependencies.tenantId);
      const [tasks, cards, rules] = await Promise.all([
        dependencies.store.tasks.list({ tenantId: dependencies.tenantId, limit: 500 }),
        dependencies.store.cards.list({ tenantId: dependencies.tenantId, limit: 500 }),
        dependencies.store.rules.list(dependencies.tenantId, true),
      ]);
      return {
        tasks: {
          total: tasks.length,
          byTemperature: countBy(tasks.map((task) => task.temperature)),
          byStatus: countBy(tasks.map((task) => task.status)),
        },
        pendingCards: cards.filter((card) => card.status === 'pending').length,
        enabledRules: rules.length,
        failedAiRuns: 0,
      };
    });

    app.get('/events', { schema: docs('Recent events', ['debug']) }, async (request) => {
      const { limit } = parseWith(DebugEventsQuerySchema, request.query);
      const items = dependencies.store.debug
        ? dependencies.store.debug.recentEvents(dependencies.tenantId, limit)
        : dependencies.store.events.list(dependencies.tenantId, limit);
      return { items };
    });
  };
  return plugin;
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}
