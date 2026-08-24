import { createDeterministicAI } from '@lifeos/ai';
import { createDatabase } from '@lifeos/db';
import { buildApp } from './app.js';
import { readConfig } from './config.js';
import { startRepeatScheduler } from './repeat-scheduler.js';

const config = readConfig();
const database = createDatabase({ filename: config.databaseUrl });
const ai = createDeterministicAI({ timeZone: config.workspaceTimezone });
const app = await buildApp({
  dependencies: { store: database.store, ai },
  timeZone: config.workspaceTimezone,
  debugApiEnabled: config.debugApiEnabled,
  ...(config.debugApiKey ? { debugApiKey: config.debugApiKey } : {}),
  ...(config.corsOrigin !== undefined ? { corsOrigin: config.corsOrigin } : {}),
  logger: true,
});

function generateRepeatTasks(): void {
  const results = database.store.repeatTemplates.generateAll(
    undefined,
    undefined,
    { type: 'system', id: 'repeat-scheduler' },
  );
  const generated = results.reduce((sum, result) => sum + result.tasks.length, 0);
  if (generated > 0) app.log.info({ generated }, 'generated repeat task instances');
}

const repeatScheduler = startRepeatScheduler(generateRepeatTasks, {
  onError: (error) => app.log.error(error, 'repeat task generation failed'),
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  repeatScheduler.stop();
  await app.close();
  database.close();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  database.close();
  process.exitCode = 1;
}
