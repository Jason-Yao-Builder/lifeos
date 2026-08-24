import type { LifeOSDatabase } from '../../packages/db/src/index.js';
import { DEFAULT_TENANT_ID } from '../../packages/db/src/index.js';
import { taskImageStorageStats } from '../lib.js';

type Sqlite = LifeOSDatabase['sqlite'];

export interface StateCounts {
  tasks: number;
  events: number;
  aiRuns: number;
  cards: number;
  conversations: number;
  messages: number;
  rules: number;
  goals: number;
  dependencies: number;
  repeatTemplates: number;
  reviews: number;
  taskImages: number;
  taskImageBytes: number;
  taskImagesAvailable: boolean;
}

export interface TaskResetPlan {
  found: boolean;
  taskId: string;
  title?: string;
  cards: string[];
  conversations: string[];
  dependencies: string[];
  retainedAiRuns: string[];
  events: number;
  messages: number;
  taskImages: number;
  taskImageBytes: number;
  taskImagesAvailable: boolean;
}

function count(sqlite: Sqlite, sql: string, ...params: string[]): number {
  return (sqlite.prepare(sql).get(...params) as { value: number } | undefined)?.value ?? 0;
}

function ids(sqlite: Sqlite, sql: string, ...params: string[]): string[] {
  return (sqlite.prepare(sql).all(...params) as Array<{ id: string }>).map((row) => row.id);
}

function placeholders(values: string[]): string {
  return values.map(() => '?').join(', ');
}

function eventTargets(
  taskId: string,
  cards: string[],
  conversations: string[],
  dependencies: string[],
) {
  const clauses = ['(aggregate_type = ? AND aggregate_id = ?)'];
  const params = ['task', taskId];
  for (const [type, values] of [
    ['card', cards],
    ['conversation', conversations],
    ['task_dependency', dependencies],
  ] as const) {
    if (values.length === 0) continue;
    clauses.push(`(aggregate_type = ? AND aggregate_id IN (${placeholders(values)}))`);
    params.push(type, ...values);
  }
  return { sql: clauses.join(' OR '), params };
}

export function workspaceCounts(sqlite: Sqlite): StateCounts {
  const workspaceId = DEFAULT_TENANT_ID;
  const imageStats = taskImageStorageStats(sqlite, workspaceId);
  return {
    tasks: count(sqlite, 'SELECT COUNT(*) value FROM tasks WHERE workspace_id = ?', workspaceId),
    events: count(sqlite, 'SELECT COUNT(*) value FROM events WHERE workspace_id = ?', workspaceId),
    aiRuns: count(sqlite, 'SELECT COUNT(*) value FROM ai_runs WHERE workspace_id = ?', workspaceId),
    cards: count(sqlite, 'SELECT COUNT(*) value FROM cards WHERE workspace_id = ?', workspaceId),
    conversations: count(sqlite, 'SELECT COUNT(*) value FROM conversations WHERE workspace_id = ?', workspaceId),
    messages: count(sqlite, `SELECT COUNT(*) value FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.workspace_id = ?`, workspaceId),
    rules: count(sqlite, 'SELECT COUNT(*) value FROM rules WHERE workspace_id = ?', workspaceId),
    goals: count(sqlite, 'SELECT COUNT(*) value FROM goals WHERE workspace_id = ?', workspaceId),
    dependencies: count(sqlite, 'SELECT COUNT(*) value FROM task_dependencies WHERE workspace_id = ?', workspaceId),
    repeatTemplates: count(sqlite, 'SELECT COUNT(*) value FROM repeat_templates WHERE workspace_id = ?', workspaceId),
    reviews: count(sqlite, 'SELECT COUNT(*) value FROM review_cards WHERE workspace_id = ?', workspaceId),
    taskImages: imageStats.count,
    taskImageBytes: imageStats.totalBytes,
    taskImagesAvailable: imageStats.available,
  };
}

export function resetAll(database: LifeOSDatabase): StateCounts {
  const sqlite = database.sqlite;
  const workspaceId = DEFAULT_TENANT_ID;
  sqlite.transaction(() => {
    sqlite.prepare(`DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE workspace_id = ?)`).run(workspaceId);
    sqlite.prepare('DELETE FROM conversations WHERE workspace_id = ?').run(workspaceId);
    sqlite.prepare('DELETE FROM cards WHERE workspace_id = ?').run(workspaceId);
    sqlite.prepare('DELETE FROM ai_runs WHERE workspace_id = ?').run(workspaceId);
    sqlite.prepare('DELETE FROM task_dependencies WHERE workspace_id = ?').run(workspaceId);
    sqlite.prepare('DELETE FROM review_cards WHERE workspace_id = ?').run(workspaceId);
    sqlite.prepare('DELETE FROM events WHERE workspace_id = ?').run(workspaceId);
    sqlite.prepare('DELETE FROM tasks WHERE workspace_id = ?').run(workspaceId);
    sqlite.prepare('DELETE FROM repeat_templates WHERE workspace_id = ?').run(workspaceId);
    sqlite.prepare('DELETE FROM goals WHERE workspace_id = ?').run(workspaceId);
    sqlite.prepare('DELETE FROM rules WHERE workspace_id = ?').run(workspaceId);
  }).immediate();
  database.seed();
  const violations = sqlite.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) throw new Error('Foreign key check failed after reset');
  return workspaceCounts(sqlite);
}

export function planTaskReset(sqlite: Sqlite, taskId: string): TaskResetPlan {
  const workspaceId = DEFAULT_TENANT_ID;
  const imageStats = taskImageStorageStats(sqlite, workspaceId, taskId);
  const task = sqlite
    .prepare('SELECT id, title FROM tasks WHERE workspace_id = ? AND id = ?')
    .get(workspaceId, taskId) as { id: string; title: string } | undefined;
  if (!task) {
    return {
      found: false,
      taskId,
      cards: [],
      conversations: [],
      dependencies: [],
      retainedAiRuns: [],
      events: 0,
      messages: 0,
      taskImages: imageStats.count,
      taskImageBytes: imageStats.totalBytes,
      taskImagesAvailable: imageStats.available,
    };
  }

  const cards = ids(sqlite, 'SELECT id FROM cards WHERE workspace_id = ? AND task_id = ?', workspaceId, taskId);
  const conversations = cards.length === 0
    ? []
    : ids(sqlite, `SELECT id FROM conversations WHERE workspace_id = ? AND card_id IN (${placeholders(cards)})`, workspaceId, ...cards);
  const retainedAiRuns = ids(sqlite, `SELECT DISTINCT ai_run_id id FROM cards WHERE workspace_id = ? AND task_id = ? AND ai_run_id IS NOT NULL`, workspaceId, taskId);
  const dependencies = ids(
    sqlite,
    'SELECT id FROM task_dependencies WHERE workspace_id = ? AND (predecessor_id = ? OR successor_id = ?)',
    workspaceId,
    taskId,
    taskId,
  );
  const targets = eventTargets(taskId, cards, conversations, dependencies);
  return {
    found: true,
    taskId,
    title: task.title,
    cards,
    conversations,
    dependencies,
    retainedAiRuns,
    events: count(sqlite, `SELECT COUNT(*) value FROM events WHERE workspace_id = ? AND (${targets.sql})`, workspaceId, ...targets.params),
    messages: conversations.length === 0 ? 0 : count(sqlite, `SELECT COUNT(*) value FROM messages WHERE conversation_id IN (${placeholders(conversations)})`, ...conversations),
    taskImages: imageStats.count,
    taskImageBytes: imageStats.totalBytes,
    taskImagesAvailable: imageStats.available,
  };
}

export function resetTask(database: LifeOSDatabase, taskId: string): TaskResetPlan {
  const sqlite = database.sqlite;
  const workspaceId = DEFAULT_TENANT_ID;
  const plan = planTaskReset(sqlite, taskId);
  if (!plan.found) throw new Error(`Task not found: ${taskId}`);
  const targets = eventTargets(taskId, plan.cards, plan.conversations, plan.dependencies);
  sqlite.transaction(() => {
    if (plan.conversations.length > 0) {
      sqlite.prepare(`DELETE FROM messages WHERE conversation_id IN (${placeholders(plan.conversations)})`).run(...plan.conversations);
      sqlite.prepare(`DELETE FROM conversations WHERE id IN (${placeholders(plan.conversations)})`).run(...plan.conversations);
    }
    if (plan.cards.length > 0) sqlite.prepare(`DELETE FROM cards WHERE id IN (${placeholders(plan.cards)})`).run(...plan.cards);
    if (plan.dependencies.length > 0) {
      sqlite.prepare(`DELETE FROM task_dependencies WHERE id IN (${placeholders(plan.dependencies)})`).run(...plan.dependencies);
    }
    sqlite.prepare(`DELETE FROM events WHERE workspace_id = ? AND (${targets.sql})`).run(workspaceId, ...targets.params);
    sqlite.prepare('DELETE FROM tasks WHERE workspace_id = ? AND id = ?').run(workspaceId, taskId);
  }).immediate();
  const violations = sqlite.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) throw new Error('Foreign key check failed after task reset');
  return plan;
}
