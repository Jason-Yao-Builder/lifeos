import { createAiRunOperations, type AiRunOperations } from './ai-runs.js';
import { createCardOperations, type CardOperations } from './cards.js';
import {
  createConversationOperations,
  type ConversationOperations,
} from './conversations.js';
import { createDebugOperations, type DebugOperations } from './debug.js';
import { createEventOperations, type EventOperations } from './events.js';
import { createRuleOperations, type RuleOperations } from './rules.js';
import { createTaskOperations, type TaskOperations } from './tasks.js';
import type { SqliteDatabase, StoreExecutor } from './runtime.js';

export interface LifeOSStore {
  tasks: TaskOperations;
  events: EventOperations;
  cards: CardOperations;
  conversations: ConversationOperations;
  rules: RuleOperations;
  aiRuns: AiRunOperations;
  debug: DebugOperations;
  transaction<T>(callback: (store: LifeOSStore) => T): T;
}

export function createStore(
  root: SqliteDatabase,
  executor: StoreExecutor = root,
  inTransaction = false,
  now: () => Date = () => new Date(),
): LifeOSStore {
  const runtime = { root, executor, inTransaction, now };
  const store: LifeOSStore = {
    tasks: createTaskOperations(runtime),
    events: createEventOperations(runtime),
    cards: createCardOperations(runtime),
    conversations: createConversationOperations(runtime),
    rules: createRuleOperations(runtime),
    aiRuns: createAiRunOperations(runtime),
    debug: createDebugOperations(runtime),
    transaction(callback) {
      if (inTransaction) return callback(store);
      return root.transaction((tx) => callback(createStore(root, tx, true, now)));
    },
  };
  return store;
}

export type {
  AiRunOperations,
  CardOperations,
  ConversationOperations,
  DebugOperations,
  EventOperations,
  RuleOperations,
  TaskOperations,
};
export type { SqliteDatabase, SqliteTransaction, StoreExecutor } from './runtime.js';
