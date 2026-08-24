import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, DEFAULT_TENANT_ID, type LifeOSDatabase } from '../packages/db/src/index.js';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));

type Sqlite = LifeOSDatabase['sqlite'];

export const TASK_IMAGES_MIGRATION_HINT =
  '`task_images` table is missing. Run `pnpm db:migrate` before managing attachments; this command did not create or migrate the database.';

export interface TaskImageStorageStats {
  available: boolean;
  count: number;
  totalBytes: number;
  migrationHint: string | null;
}

export function taskImageStorageStats(
  sqlite: Sqlite,
  workspaceId: string,
  taskId?: string,
): TaskImageStorageStats {
  const available = Boolean(
    sqlite
      .prepare("SELECT 1 present FROM sqlite_master WHERE type = 'table' AND name = 'task_images'")
      .get(),
  );
  if (!available) {
    return {
      available: false,
      count: 0,
      totalBytes: 0,
      migrationHint: TASK_IMAGES_MIGRATION_HINT,
    };
  }
  const taskClause = taskId === undefined ? '' : ' AND task_id = ?';
  const params = taskId === undefined ? [workspaceId] : [workspaceId, taskId];
  const row = sqlite
    .prepare(
      `SELECT COUNT(*) count, COALESCE(SUM(size_bytes), 0) totalBytes
       FROM task_images WHERE workspace_id = ?${taskClause}`,
    )
    .get(...params) as { count: number; totalBytes: number };
  return {
    available: true,
    count: row.count,
    totalBytes: row.totalBytes,
    migrationHint: null,
  };
}

export function hasFlag(name: string, argv = process.argv.slice(2)): boolean {
  return argv.includes(name);
}

export function option(name: string, argv = process.argv.slice(2)): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

export function positiveIntegerOption(name: string, fallback: number): number {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function resolveDatabaseFilename(): string {
  const configured = option('--database') ?? process.env.DATABASE_URL ?? 'data/lifeos.db';
  const filename = configured.replace(/^file:/, '');
  if (filename === ':memory:') return filename;
  return isAbsolute(filename) ? filename : resolve(workspaceRoot, filename);
}

export function openExistingDatabase(): { database: LifeOSDatabase; filename: string } {
  const filename = resolveDatabaseFilename();
  if (filename === ':memory:') throw new Error('Maintenance scripts require a persistent database file');
  const relativePath = relative(workspaceRoot, filename);
  if ((relativePath.startsWith('..') || isAbsolute(relativePath)) && !hasFlag('--allow-external')) {
    throw new Error('Database is outside workspace; add --allow-external after verifying the path');
  }
  if (!existsSync(filename)) {
    throw new Error(`Database does not exist: ${filename}`);
  }
  return {
    filename,
    database: createDatabase({ filename, autoMigrate: false, autoSeed: false }),
  };
}

export function printHeading(title: string, filename: string): void {
  console.log(`\n${title}`);
  console.log(`Database: ${filename}`);
  console.log(`Workspace: ${DEFAULT_TENANT_ID}\n`);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
