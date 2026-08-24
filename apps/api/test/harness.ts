import { createDeterministicAI } from '@lifeos/ai';
import type { TaskDto } from '@lifeos/contracts';
import { createDatabase, type LifeOSDatabase } from '@lifeos/db';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { ApiAi } from '../src/services.js';

export interface TestHarness {
  app: FastifyInstance;
  database: LifeOSDatabase;
  now: Date;
  close(): Promise<void>;
}

export async function createTestHarness(
  options: {
    debugApiKey?: string;
    ai?: ApiAi;
    timeZone?: string;
    corsOrigin?: string | boolean;
  } = {},
): Promise<TestHarness> {
  const now = new Date('2026-08-21T09:00:00+08:00');
  const clock = () => new Date(now);
  const timeZone = options.timeZone ?? 'Asia/Shanghai';
  const database = createDatabase({ filename: ':memory:', now: clock });
  const app = await buildApp({
    dependencies: {
      store: database.store,
      ai: options.ai ?? createDeterministicAI({ now: clock, timeZone }),
      now: clock,
    },
    timeZone,
    debugApiEnabled: true,
    ...(options.debugApiKey ? { debugApiKey: options.debugApiKey } : {}),
    ...(options.corsOrigin !== undefined ? { corsOrigin: options.corsOrigin } : {}),
  });
  await app.ready();
  return {
    app,
    database,
    now,
    async close() {
      await app.close();
      database.close();
    },
  };
}

export async function createTask(
  app: FastifyInstance,
  input: Record<string, unknown>,
): Promise<TaskDto> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/tasks', payload: input });
  if (response.statusCode !== 201) throw new Error(response.body);
  return response.json<TaskDto>();
}
