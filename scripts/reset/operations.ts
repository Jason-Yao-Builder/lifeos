import type { LifeOSDatabase } from '../../packages/db/src/index.js';
import { DEFAULT_TENANT_ID } from '../../packages/db/src/index.js';

type Sqlite = LifeOSDatabase['sqlite'];

export interface StateCounts {
  tasks: number;
  events: number;
  aiRuns: number;
  cards: number;
  conversations: number;
  messages: number;
  rules: number;
}

export interface TaskResetPlan {
  found: boolean;
  taskId: string;
  title?: string;
  cards: string[];
  conversations: string[];
  retainedAiRuns: string[];
  events: number;
  messages: number;
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

function eventTargets(taskId: string, cards: string[], conversations: string[]) {
  const clauses = ['(aggregate_type = ? AND aggregate_id = ?)'];
  const params = ['task', taskId];
  for (const [type, values] of [
    ['card', cards],
    ['conversation', conversations],
  ] as const) {
    if (values.length === 0) continue;
    clauses.push(`(aggregate_type = ? AND aggregate_id IN (${placeholders(values)}))`);
    params.push(type, ...values);
  }
  return { sql: clauses.join(' OR '), params };
}

export function workspaceCounts(sqlite: Sqlite): StateCounts {
  const workspaceId = DEFAULT_TENANT_ID;
  return {
    tasks: count(sqlite, 'SELECT COUNT(*) value FROM tasks WHERE workspace_id = ?', workspaceId),
    events: count(sqlite, 'SELECT COUNT(*) value FROM events WHERE workspace_id = ?', workspaceId),
    aiRuns: count(sqlite, 'SELECT COUNT(*) value FROM ai_runs WHERE workspace_id = ?', workspaceId),
    cards: count(sqlite, 'SELECT COUNT(*) value FROM cards WHERE workspace_id = ?', workspaceId),
    conversations: count(sqlite, 'SELECT COUNT(*) value FROM conversations WHERE workspace_id = ?', workspaceId),
    messages: count(sqlite, `SELECT COUNT(*) value FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.workspace_id = ?`, workspaceId),
    rules: count(sqlite, 'SELECT COUNT(*) value FROM rules WHERE workspace_id = ?', workspaceId),
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
    sqlite.prepare('DELETE FROM events WHERE workspace_id = ?').run(workspaceId);
    sqlite.prepare('DELETE FROM tasks WHERE workspace_id = ?').run(workspaceId);
    sqlite.prepare('DELETE FROM rules WHERE workspace_id = ?').run(workspaceId);
  }).immediate();
  database.seed();
  const violations = sqlite.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) throw new Error('Foreign key check failed after reset');
  return workspaceCounts(sqlite);
}

export function planTaskReset(sqlite: Sqlite, taskId: string): TaskResetPlan {
  const workspaceId = DEFAULT_TENANT_ID;
  const task = sqlite
    .prepare('SELECT id, title FROM tasks WHERE workspace_id = ? AND id = ?')
    .get(workspaceId, taskId) as { id: string; title: string } | undefined;
  if (!task) return { found: false, taskId, cards: [], conversations: [], retainedAiRuns: [], events: 0, messages: 0 };

  const cards = ids(sqlite, 'SELECT id FROM cards WHERE workspace_id = ? AND task_id = ?', workspaceId, taskId);
  const conversations = cards.length === 0
    ? []
    : ids(sqlite, `SELECT id FROM conversations WHERE workspace_id = ? AND card_id IN (${placeholders(cards)})`, workspaceId, ...cards);
  const retainedAiRuns = ids(sqlite, `SELECT DISTINCT ai_run_id id FROM cards WHERE workspace_id = ? AND task_id = ? AND ai_run_id IS NOT NULL`, workspaceId, taskId);
  const targets = eventTargets(taskId, cards, conversations);
  return {
    found: true,
    taskId,
    title: task.title,
    cards,
    conversations,
    retainedAiRuns,
    events: count(sqlite, `SELECT COUNT(*) value FROM events WHERE workspace_id = ? AND (${targets.sql})`, workspaceId, ...targets.params),
    messages: conversations.length === 0 ? 0 : count(sqlite, `SELECT COUNT(*) value FROM messages WHERE conversation_id IN (${placeholders(conversations)})`, ...conversations),
  };
}

export function resetTask(database: LifeOSDatabase, taskId: string): TaskResetPlan {
  const sqlite = database.sqlite;
  const workspaceId = DEFAULT_TENANT_ID;
  const plan = planTaskReset(sqlite, taskId);
  if (!plan.found) throw new Error(`Task not found: ${taskId}`);
  const targets = eventTargets(taskId, plan.cards, plan.conversations);
  sqlite.transaction(() => {
    if (plan.conversations.length > 0) {
      sqlite.prepare(`DELETE FROM messages WHERE conversation_id IN (${placeholders(plan.conversations)})`).run(...plan.conversations);
      sqlite.prepare(`DELETE FROM conversations WHERE id IN (${placeholders(plan.conversations)})`).run(...plan.conversations);
    }
    if (plan.cards.length > 0) sqlite.prepare(`DELETE FROM cards WHERE id IN (${placeholders(plan.cards)})`).run(...plan.cards);
    sqlite.prepare(`DELETE FROM events WHERE workspace_id = ? AND (${targets.sql})`).run(workspaceId, ...targets.params);
    sqlite.prepare('DELETE FROM tasks WHERE workspace_id = ? AND id = ?').run(workspaceId, taskId);
  }).immediate();
  const violations = sqlite.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) throw new Error('Foreign key check failed after task reset');
  return plan;
}
