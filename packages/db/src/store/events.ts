import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { encodeJson } from '../json.js';
import { events } from '../schema.js';
import type { ActorInput, EventRecord } from '../types.js';
import { DEFAULT_TENANT_ID } from '../types.js';
import { mapEvent } from './mappers.js';
import type { StoreExecutor, StoreRuntime } from './runtime.js';

export interface AppendEventInput {
  tenantId?: string;
  aggregateType: string;
  aggregateId: string;
  type: string;
  actor?: ActorInput | undefined;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

export function appendEvent(
  executor: StoreExecutor,
  input: AppendEventInput,
  now: () => Date,
): EventRecord {
  const actor = input.actor ?? { type: 'system' as const };
  const row = executor
    .insert(events)
    .values({
      id: randomUUID(),
      workspaceId: input.tenantId ?? DEFAULT_TENANT_ID,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      type: input.type,
      actorType: actor.type,
      actorId: actor.id ?? null,
      beforeJson: encodeJson(input.before),
      afterJson: encodeJson(input.after),
      metadataJson: encodeJson(input.metadata),
      correlationId: actor.correlationId ?? null,
      createdAt: now().toISOString(),
    })
    .returning()
    .get();
  return mapEvent(row);
}

export interface EventOperations {
  list(tenantId?: string, limit?: number): EventRecord[];
  forAggregate(tenantId: string, aggregateType: string, aggregateId: string): EventRecord[];
}

export function createEventOperations(runtime: StoreRuntime): EventOperations {
  return {
    list(tenantId = DEFAULT_TENANT_ID, limit = 100) {
      return runtime.executor
        .select()
        .from(events)
        .where(eq(events.workspaceId, tenantId))
        .orderBy(desc(events.createdAt))
        .limit(Math.min(Math.max(limit, 1), 500))
        .all()
        .map(mapEvent);
    },
    forAggregate(tenantId, aggregateType, aggregateId) {
      return runtime.executor
        .select()
        .from(events)
        .where(
          and(
            eq(events.workspaceId, tenantId),
            eq(events.aggregateType, aggregateType),
            eq(events.aggregateId, aggregateId),
          ),
        )
        .orderBy(events.createdAt)
        .all()
        .map(mapEvent);
    },
  };
}
