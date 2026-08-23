import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { SqliteDatabase } from './store/runtime.js';

export function migrateDatabase(db: SqliteDatabase, explicitFolder?: string): void {
  const candidates = [
    explicitFolder,
    process.env.LIFEOS_MIGRATIONS_DIR,
    resolve(process.cwd(), 'packages/db/drizzle'),
    resolve(process.cwd(), '../../packages/db/drizzle'),
    fileURLToPath(new URL('./drizzle', import.meta.url)),
    fileURLToPath(new URL('../drizzle', import.meta.url)),
  ].filter((value): value is string => Boolean(value));
  const migrationsFolder = candidates.find((folder) => existsSync(resolve(folder, 'meta/_journal.json')));
  if (!migrationsFolder) {
    throw new Error('LifeOS database migrations folder not found');
  }
  migrate(db, { migrationsFolder });
}
