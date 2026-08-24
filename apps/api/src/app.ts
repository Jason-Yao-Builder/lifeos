import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { installErrorHandling } from './http.js';
import { aiRoutes } from './routes/ai.js';
import { calendarRoutes } from './routes/calendar.js';
import { cardRoutes } from './routes/cards.js';
import { conversationRoutes } from './routes/conversations.js';
import { dayRoutes } from './routes/days.js';
import { debugRoutes } from './routes/debug.js';
import { ganttRoutes } from './routes/gantt.js';
import { goalRoutes } from './routes/goals.js';
import { repeatTemplateRoutes } from './routes/repeat-templates.js';
import { reviewRoutes } from './routes/reviews.js';
import { ruleRoutes } from './routes/rules.js';
import { taskRoutes } from './routes/tasks.js';
import { taskGroupRoutes } from './routes/task-groups.js';
import { taskImageRoutes } from './routes/task-images.js';
import { taskStructureRoutes } from './routes/task-structure.js';
import type { AppDependencies } from './services.js';

export interface BuildAppOptions {
  dependencies: AppDependencies;
  timeZone?: string;
  debugApiEnabled?: boolean;
  debugApiKey?: string;
  corsOrigin?: string | boolean;
  logger?: boolean;
}

const localWebOriginPattern = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;

function allowDefaultCorsOrigin(origin: string | undefined): Promise<boolean> {
  return Promise.resolve(origin === undefined || localWebOriginPattern.test(origin));
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const dependencies = {
    ...options.dependencies,
    tenantId: options.dependencies.tenantId ?? 'local-workspace',
    userId: options.dependencies.userId ?? 'local-user',
    now: options.dependencies.now ?? (() => new Date()),
  };
  const timeZone = options.timeZone ?? 'Asia/Shanghai';

  await app.register(cors, {
    origin: options.corsOrigin ?? allowDefaultCorsOrigin,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(swagger, {
    openapi: {
      info: { title: 'LifeOS API', version: '0.2.0' },
      tags: [
        { name: 'tasks' },
        { name: 'task-groups' },
        { name: 'days' },
        { name: 'cards' },
        { name: 'conversations' },
        { name: 'ai' },
        { name: 'rules' },
        { name: 'debug' },
        { name: 'calendar' },
        { name: 'gantt' },
        { name: 'goals' },
        { name: 'dependencies' },
        { name: 'repeat-templates' },
        { name: 'reviews' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  installErrorHandling(app);

  await app.register(taskRoutes(dependencies), { prefix: '/api/v1' });
  await app.register(taskGroupRoutes(dependencies), { prefix: '/api/v1' });
  await app.register(taskImageRoutes(dependencies), { prefix: '/api/v1' });
  await app.register(taskStructureRoutes(dependencies), { prefix: '/api/v1' });
  await app.register(dayRoutes(dependencies, timeZone), { prefix: '/api/v1' });
  await app.register(calendarRoutes(dependencies, timeZone), { prefix: '/api/v1' });
  await app.register(ganttRoutes(dependencies, timeZone), { prefix: '/api/v1' });
  await app.register(goalRoutes(dependencies), { prefix: '/api/v1' });
  await app.register(repeatTemplateRoutes(dependencies), { prefix: '/api/v1' });
  await app.register(reviewRoutes(dependencies, timeZone), { prefix: '/api/v1' });
  await app.register(cardRoutes(dependencies), { prefix: '/api/v1' });
  await app.register(conversationRoutes(dependencies), { prefix: '/api/v1' });
  await app.register(aiRoutes(dependencies, timeZone), { prefix: '/api/v1' });
  await app.register(ruleRoutes(dependencies, timeZone), { prefix: '/api/v1' });
  if (options.debugApiEnabled ?? true) {
    await app.register(debugRoutes(dependencies, omitDebugOptions(options.debugApiKey)), {
      prefix: '/api/v1/debug',
    });
  }
  return app;
}

function omitDebugOptions(apiKey: string | undefined): { apiKey?: string } {
  return apiKey ? { apiKey } : {};
}
