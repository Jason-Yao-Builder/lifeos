import { selectTodayTasks } from '@lifeos/domain';
import type { FastifyPluginAsync } from 'fastify';
import { docs, parseWith, projectTask } from '../http.js';
import { DayParamsSchema } from '../schemas.js';
import type { AppDependencies } from '../services.js';

export function dayRoutes(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId'>>,
  timeZone: string,
) {
  const plugin: FastifyPluginAsync = async (app) => {
    app.get('/days/:date', { schema: docs('List the daily execution view', ['days']) }, async (request) => {
      const { date } = parseWith(DayParamsSchema, request.params);
      const tasks = await dependencies.store.tasks.list({
        tenantId: dependencies.tenantId,
        limit: 500,
      });
      return {
        items: selectTodayTasks(tasks, { today: date, timeZone }).map((task) =>
          projectTask(
            task,
            dependencies.store.dependencies.isBlocked(dependencies.tenantId, task.id),
          ),
        ),
      };
    });
  };
  return plugin;
}
