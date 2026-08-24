import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { InvalidMutationError, NotFoundError } from '../errors.js';
import { encodeJson } from '../json.js';
import { reviewCards } from '../schema.js';
import type {
  ActorInput,
  CreateReviewCardInput,
  ReviewCardListFilters,
  ReviewCardRecord,
} from '../types.js';
import { DEFAULT_TENANT_ID, DEFAULT_USER_ID } from '../types.js';
import { appendEvent } from './events.js';
import { mapReviewCard } from './mappers.js';
import { atomic, type StoreRuntime } from './runtime.js';

export interface ReviewOperations {
  list(filters?: ReviewCardListFilters): ReviewCardRecord[];
  get(tenantId: string, id: string): ReviewCardRecord | null;
  create(input: CreateReviewCardInput, actor?: ActorInput): ReviewCardRecord;
  update(tenantId: string, id: string, content: unknown, actor?: ActorInput): ReviewCardRecord;
}

export function createReviewOperations(runtime: StoreRuntime): ReviewOperations {
  const get = (tenantId: string, id: string): ReviewCardRecord | null => {
    const row = runtime.executor
      .select()
      .from(reviewCards)
      .where(and(eq(reviewCards.workspaceId, tenantId), eq(reviewCards.id, id)))
      .get();
    return row ? mapReviewCard(row) : null;
  };

  return {
    list(filters = {}) {
      const tenantId = filters.tenantId ?? DEFAULT_TENANT_ID;
      const conditions: SQL[] = [eq(reviewCards.workspaceId, tenantId)];
      if (filters.type) conditions.push(eq(reviewCards.type, filters.type));
      if (filters.periodFrom) conditions.push(gte(reviewCards.periodEnd, filters.periodFrom));
      if (filters.periodTo) conditions.push(lte(reviewCards.periodStart, filters.periodTo));
      return runtime.executor
        .select()
        .from(reviewCards)
        .where(and(...conditions))
        .orderBy(desc(reviewCards.periodStart), desc(reviewCards.createdAt))
        .limit(Math.min(Math.max(filters.limit ?? 100, 1), 500))
        .all()
        .map(mapReviewCard);
    },
    get,
    create(input, actor) {
      return atomic(runtime, (tx) => {
        const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
        if (input.periodStart > input.periodEnd) {
          throw new InvalidMutationError('Review period start must not be after end');
        }
        const now = runtime.now().toISOString();
        const row = tx
          .insert(reviewCards)
          .values({
            id: input.id ?? randomUUID(),
            workspaceId: tenantId,
            ownerId: input.ownerId ?? DEFAULT_USER_ID,
            type: input.type,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            contentJson: encodeJson(input.content) ?? 'null',
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        const record = mapReviewCard(row);
        appendEvent(tx, {
          tenantId,
          aggregateType: 'review_card',
          aggregateId: row.id,
          type: 'review_card.created',
          actor,
          after: record,
        }, runtime.now);
        return record;
      });
    },
    update(tenantId, id, content, actor) {
      return atomic(runtime, (tx) => {
        const beforeRow = tx
          .select()
          .from(reviewCards)
          .where(and(eq(reviewCards.workspaceId, tenantId), eq(reviewCards.id, id)))
          .get();
        if (!beforeRow) throw new NotFoundError('review_card', id);
        const row = tx
          .update(reviewCards)
          .set({ contentJson: encodeJson(content) ?? 'null', updatedAt: runtime.now().toISOString() })
          .where(eq(reviewCards.id, id))
          .returning()
          .get();
        const before = mapReviewCard(beforeRow);
        const after = mapReviewCard(row);
        appendEvent(tx, {
          tenantId,
          aggregateType: 'review_card',
          aggregateId: id,
          type: 'review_card.updated',
          actor,
          before,
          after,
        }, runtime.now);
        return after;
      });
    },
  };
}
