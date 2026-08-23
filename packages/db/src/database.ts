import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrateDatabase } from './migrations.js';
import { schema } from './schema.js';
import { seedDefaults } from './seed.js';
import { createStore, type LifeOSStore } from './store/index.js';
import type { SqliteDatabase } from './store/runtime.js';

export interface CreateDatabaseOptions {
  filename?: string;
  autoMigrate?: boolean;
  autoSeed?: boolean;
  migrationsFolder?: string;
  now?: () => Date;
}

export interface LifeOSDatabase {
  db: SqliteDatabase;
  sqlite: BetterSqlite3.Database;
  store: LifeOSStore;
  migrate(): void;
  seed(): void;
  transaction<T>(callback: (store: LifeOSStore) => T): T;
  close(): void;
}

function resolveFilename(input?: string): string {
  const configured = input ?? process.env.DATABASE_URL ?? './data/lifeos.db';
  return configured.replace(/^file:/, '');
}

export function createDatabase(options: CreateDatabaseOptions = {}): LifeOSDatabase {
  const filename = resolveFilename(options.filename);
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
  const sqlite = new BetterSqlite3(filename);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  const now = options.now ?? (() => new Date());
  const migrate = () => migrateDatabase(db, options.migrationsFolder);
  const seed = () => seedDefaults(db, now);
  if (options.autoMigrate ?? true) migrate();
  if (options.autoSeed ?? true) seed();
  sqlite.pragma('optimize');
  const store = createStore(db, db, false, now);
  return {
    db,
    sqlite,
    store,
    migrate,
    seed,
    transaction: (callback) => store.transaction(callback),
    close: () => sqlite.close(),
  };
}
