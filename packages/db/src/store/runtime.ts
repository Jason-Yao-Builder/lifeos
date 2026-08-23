import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { schema } from '../schema.js';

export type SqliteDatabase = BetterSQLite3Database<typeof schema>;
export type SqliteTransaction = Parameters<Parameters<SqliteDatabase['transaction']>[0]>[0];
export type StoreExecutor = SqliteDatabase | SqliteTransaction;

export interface StoreRuntime {
  root: SqliteDatabase;
  executor: StoreExecutor;
  inTransaction: boolean;
  now: () => Date;
}

export function atomic<T>(runtime: StoreRuntime, operation: (tx: StoreExecutor) => T): T {
  if (runtime.inTransaction) return operation(runtime.executor);
  return runtime.root.transaction((tx) => operation(tx));
}
