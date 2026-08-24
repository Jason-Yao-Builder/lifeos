import { createAiRunOperations, type AiRunOperations } from './ai-runs.js';
import { createCardOperations, type CardOperations } from './cards.js';
import {
  createConversationOperations,
  type ConversationOperations,
} from './conversations.js';
import { createDebugOperations, type DebugOperations } from './debug.js';
import { createEventOperations, type EventOperations } from './events.js';
import { createDependencyOperations, type DependencyOperations } from './dependencies.js';
import { createGoalOperations, type GoalOperations } from './goals.js';
import {
  createRepeatTemplateOperations,
  type RepeatTemplateOperations,
} from './repeat-templates.js';
import { createReviewOperations, type ReviewOperations } from './reviews.js';
import { createRuleOperations, type RuleOperations } from './rules.js';
import { createTaskOperations, type TaskOperations } from './tasks.js';
import {
  createTaskImageOperations,
  type TaskImageOperations,
} from './task-images.js';
import type { SqliteDatabase, StoreExecutor } from './runtime.js';

export interface LifeOSStore {
  tasks: TaskOperations;
  taskImages: TaskImageOperations;
  goals: GoalOperations;
  dependencies: DependencyOperations;
  repeatTemplates: RepeatTemplateOperations;
  reviews: ReviewOperations;
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
    taskImages: createTaskImageOperations(runtime),
    goals: createGoalOperations(runtime),
    dependencies: createDependencyOperations(runtime),
    repeatTemplates: createRepeatTemplateOperations(runtime),
    reviews: createReviewOperations(runtime),
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
  DependencyOperations,
  EventOperations,
  GoalOperations,
  RepeatTemplateOperations,
  ReviewOperations,
  RuleOperations,
  TaskOperations,
  TaskImageOperations,
};
export type { SqliteDatabase, SqliteTransaction, StoreExecutor } from './runtime.js';
