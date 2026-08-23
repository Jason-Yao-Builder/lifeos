import { randomUUID } from 'node:crypto';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { NotFoundError, VersionConflictError } from '../errors.js';
import { encodeJson } from '../json.js';
import { cards } from '../schema.js';
import type {
  ActorInput,
  CardListFilters,
  CardRecord,
  CardStatus,
  CreateCardInput,
} from '../types.js';
import { DEFAULT_TENANT_ID } from '../types.js';
import { appendEvent } from './events.js';
import { mapCard } from './mappers.js';
import { atomic, type StoreRuntime } from './runtime.js';

export interface CardOperations {
  list(filters?: CardListFilters): CardRecord[];
  get(tenantId: string, id: string): CardRecord | null;
  create(input: CreateCardInput, actor?: ActorInput): CardRecord;
  decide(
    tenantId: string,
    id: string,
    expectedVersion: number,
    status: CardStatus,
    decision?: unknown,
    actor?: ActorInput,
  ): CardRecord;
}

export function createCardOperations(runtime: StoreRuntime): CardOperations {
  return {
    list(filters = {}) {
      const tenantId = filters.tenantId ?? DEFAULT_TENANT_ID;
      const conditions: SQL[] = [eq(cards.workspaceId, tenantId)];
      if (filters.status) conditions.push(eq(cards.status, filters.status));
      if (filters.type) conditions.push(eq(cards.type, filters.type));
      if (filters.targetTaskId) conditions.push(eq(cards.taskId, filters.targetTaskId));
      return runtime.executor
        .select()
        .from(cards)
        .where(and(...conditions))
        .orderBy(desc(cards.createdAt))
        .limit(Math.min(Math.max(filters.limit ?? 100, 1), 500))
        .all()
        .map(mapCard);
    },
    get(tenantId, id) {
      const row = runtime.executor
        .select()
        .from(cards)
        .where(and(eq(cards.workspaceId, tenantId), eq(cards.id, id)))
        .get();
      return row ? mapCard(row) : null;
    },
    create(input, actor) {
      return atomic(runtime, (tx) => {
        const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
        const now = runtime.now().toISOString();
        const row = tx
          .insert(cards)
          .values({
            id: input.id ?? randomUUID(),
            workspaceId: tenantId,
            taskId: input.targetTaskId ?? null,
            aiRunId: input.aiRunId ?? null,
            type: input.type,
            title: input.title,
            body: input.body,
            proposalJson: encodeJson(input.proposal),
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        const record = mapCard(row);
        appendEvent(tx, { tenantId, aggregateType: 'card', aggregateId: row.id, type: 'card.created', actor, after: record }, runtime.now);
        return record;
      });
    },
    decide(tenantId, id, expectedVersion, status, decision, actor) {
      return atomic(runtime, (tx) => {
        const beforeRow = tx.select().from(cards).where(and(eq(cards.workspaceId, tenantId), eq(cards.id, id))).get();
        if (!beforeRow) throw new NotFoundError('card', id);
        if (beforeRow.version !== expectedVersion) throw new VersionConflictError('card', id);
        const now = runtime.now().toISOString();
        const isResolved = ['accepted', 'rejected', 'dismissed', 'resolved', 'archived'].includes(status);
        const updated = tx
          .update(cards)
          .set({
            status,
            decisionJson: encodeJson(decision),
            decidedAt: isResolved ? now : null,
            updatedAt: now,
            version: expectedVersion + 1,
          })
          .where(and(eq(cards.id, id), eq(cards.version, expectedVersion)))
          .returning()
          .get();
        if (!updated) throw new VersionConflictError('card', id);
        const before = mapCard(beforeRow);
        const after = mapCard(updated);
        appendEvent(tx, { tenantId, aggregateType: 'card', aggregateId: id, type: 'card.decided', actor, before, after }, runtime.now);
        return after;
      });
    },
  };
}
