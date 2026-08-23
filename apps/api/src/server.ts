import { createDeterministicAI } from '@lifeos/ai';
import { createDatabase } from '@lifeos/db';
import { buildApp } from './app.js';
import { readConfig } from './config.js';

const config = readConfig();
const database = createDatabase({ filename: config.databaseUrl });
const ai = createDeterministicAI({ timeZone: config.workspaceTimezone });
const app = await buildApp({
  dependencies: { store: database.store, ai },
  timeZone: config.workspaceTimezone,
  debugApiEnabled: config.debugApiEnabled,
  ...(config.debugApiKey ? { debugApiKey: config.debugApiKey } : {}),
  corsOrigin: config.corsOrigin,
  logger: true,
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutting down');
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
