import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AppConfig {
  host: string;
  port: number;
  databaseUrl: string;
  workspaceTimezone: string;
  debugApiEnabled: boolean;
  debugApiKey?: string;
  corsOrigin?: string | boolean;
}

function asBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? 4310);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const debugApiKey = env.DEBUG_API_KEY?.trim();
  const corsOrigin = env.CORS_ORIGIN?.trim();
  const configuredDatabase = env.DATABASE_URL?.trim();
  const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const defaultDatabase = resolve(workspaceRoot, 'data/lifeos.db');
  const databaseUrl = configuredDatabase
    ? resolveDatabaseUrl(configuredDatabase, workspaceRoot)
    : defaultDatabase;
  return {
    host: env.HOST ?? '127.0.0.1',
    port,
    databaseUrl,
    workspaceTimezone: env.WORKSPACE_TIMEZONE ?? 'Asia/Shanghai',
    debugApiEnabled: asBoolean(env.DEBUG_API_ENABLED, env.NODE_ENV !== 'production'),
    ...(debugApiKey ? { debugApiKey } : {}),
    ...(corsOrigin ? { corsOrigin } : {}),
  };
}

function resolveDatabaseUrl(value: string, workspaceRoot: string): string {
  if (value === ':memory:') return value;
  const fileScheme = value.startsWith('file:');
  const filename = fileScheme ? value.slice('file:'.length) : value;
  const resolved = resolve(workspaceRoot, filename);
  return fileScheme ? `file:${resolved}` : resolved;
}
