import { DEFAULT_TENANT_ID, type LifeOSDatabase } from '../../packages/db/src/index.js';

type Sqlite = LifeOSDatabase['sqlite'];

function count(sqlite: Sqlite, sql: string, ...params: string[]): number {
  return (sqlite.prepare(sql).get(...params) as { value: number } | undefined)?.value ?? 0;
}

function grouped(sqlite: Sqlite, sql: string, workspaceId: string): Record<string, number> {
  const rows = sqlite.prepare(sql).all(workspaceId) as Array<{ key: string; value: number }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function inspectState(database: LifeOSDatabase, limit: number) {
  const sqlite = database.sqlite;
  const workspaceId = DEFAULT_TENANT_ID;
  return {
    generatedAt: new Date().toISOString(),
    tasks: {
      total: count(sqlite, 'SELECT COUNT(*) value FROM tasks WHERE workspace_id = ?', workspaceId),
      active: count(sqlite, 'SELECT COUNT(*) value FROM tasks WHERE workspace_id = ? AND deleted_at IS NULL', workspaceId),
      softDeleted: count(sqlite, 'SELECT COUNT(*) value FROM tasks WHERE workspace_id = ? AND deleted_at IS NOT NULL', workspaceId),
      byStatus: grouped(sqlite, 'SELECT status key, COUNT(*) value FROM tasks WHERE workspace_id = ? GROUP BY status', workspaceId),
      byTemperature: grouped(sqlite, 'SELECT temperature key, COUNT(*) value FROM tasks WHERE workspace_id = ? GROUP BY temperature', workspaceId),
      recent: sqlite.prepare(
        `SELECT id, title, status, temperature, version, updated_at updatedAt, deleted_at deletedAt
         FROM tasks WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?`,
      ).all(workspaceId, limit) as Array<Record<string, unknown>>,
    },
    cards: {
      total: count(sqlite, 'SELECT COUNT(*) value FROM cards WHERE workspace_id = ?', workspaceId),
      byStatus: grouped(sqlite, 'SELECT status key, COUNT(*) value FROM cards WHERE workspace_id = ? GROUP BY status', workspaceId),
    },
    conversations: count(sqlite, 'SELECT COUNT(*) value FROM conversations WHERE workspace_id = ?', workspaceId),
    messages: count(sqlite, `SELECT COUNT(*) value FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.workspace_id = ?`, workspaceId),
    aiRuns: {
      total: count(sqlite, 'SELECT COUNT(*) value FROM ai_runs WHERE workspace_id = ?', workspaceId),
      byStatus: grouped(sqlite, 'SELECT status key, COUNT(*) value FROM ai_runs WHERE workspace_id = ? GROUP BY status', workspaceId),
    },
    rules: {
      total: count(sqlite, 'SELECT COUNT(*) value FROM rules WHERE workspace_id = ?', workspaceId),
      enabled: count(sqlite, 'SELECT COUNT(*) value FROM rules WHERE workspace_id = ? AND enabled = 1', workspaceId),
    },
    events: {
      total: count(sqlite, 'SELECT COUNT(*) value FROM events WHERE workspace_id = ?', workspaceId),
      recent: database.store.debug.recentEvents(workspaceId, limit).map((event) => ({
        id: event.id,
        at: event.createdAt,
        actor: event.actorType,
        type: event.type,
        aggregate: `${event.aggregateType}/${event.aggregateId}`,
      })),
    },
  };
}

interface TimelineEventRow {
  id: string;
  aggregateType: string;
  aggregateId: string;
  type: string;
  actorType: string;
  beforeJson: string | null;
  afterJson: string | null;
  createdAt: string;
}

function decode(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function summarize(row: TimelineEventRow): string {
  const before = decode(row.beforeJson);
  const after = decode(row.afterJson);
  const fields = ['status', 'temperature', 'plannedDate', 'deadline', 'rank', 'score', 'version'];
  const changes = fields
    .map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null }))
    .filter(({ before: beforeValue, after: afterValue }) => JSON.stringify(beforeValue) !== JSON.stringify(afterValue))
    .map(({ field, before: beforeValue, after: afterValue }) => `${field}: ${String(beforeValue ?? '∅')} → ${String(afterValue ?? '∅')}`);
  return changes.join('; ') || 'no visible field change';
}

export function inspectTaskTimeline(database: LifeOSDatabase, taskId: string) {
  const sqlite = database.sqlite;
  const workspaceId = DEFAULT_TENANT_ID;
  const task = sqlite.prepare(
    `SELECT id, title, status, temperature, version, planned_date plannedDate,
      deadline_at deadline, completed_at completedAt, deleted_at deletedAt
     FROM tasks WHERE workspace_id = ? AND id = ?`,
  ).get(workspaceId, taskId) as Record<string, unknown> | undefined;
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const eventRows = sqlite.prepare(
    `SELECT id, aggregate_type aggregateType, aggregate_id aggregateId, type,
      actor_type actorType, before_json beforeJson, after_json afterJson, created_at createdAt
     FROM events WHERE workspace_id = ? AND (
       (aggregate_type = 'task' AND aggregate_id = ?) OR
       (aggregate_type = 'card' AND aggregate_id IN (SELECT id FROM cards WHERE workspace_id = ? AND task_id = ?)) OR
       (aggregate_type = 'conversation' AND aggregate_id IN (
         SELECT c.id FROM conversations c JOIN cards ca ON ca.id = c.card_id WHERE c.workspace_id = ? AND ca.task_id = ?
       )) OR
       (aggregate_type = 'ai_run' AND aggregate_id IN (SELECT ai_run_id FROM cards WHERE workspace_id = ? AND task_id = ? AND ai_run_id IS NOT NULL))
     ) ORDER BY created_at, id`,
  ).all(workspaceId, taskId, workspaceId, taskId, workspaceId, taskId, workspaceId, taskId) as TimelineEventRow[];
  const messages = sqlite.prepare(
    `SELECT m.id, m.role, m.content, m.created_at createdAt, m.conversation_id conversationId
     FROM messages m JOIN conversations c ON c.id = m.conversation_id JOIN cards ca ON ca.id = c.card_id
     WHERE c.workspace_id = ? AND ca.task_id = ? ORDER BY m.created_at, m.id`,
  ).all(workspaceId, taskId) as Array<Record<string, unknown>>;

  return {
    task,
    events: eventRows.map((event) => ({
      id: event.id,
      at: event.createdAt,
      actor: event.actorType,
      type: event.type,
      aggregate: `${event.aggregateType}/${event.aggregateId}`,
      change: summarize(event),
    })),
    messages,
  };
}
