import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { InvalidMutationError, NotFoundError } from '../errors.js';
import { encodeJson } from '../json.js';
import { aiRuns } from '../schema.js';
import type { AiRunRecord, CreateAiRunInput } from '../types.js';
import { DEFAULT_TENANT_ID } from '../types.js';
import { appendEvent } from './events.js';
import { mapAiRun } from './mappers.js';
import { atomic, type StoreRuntime } from './runtime.js';

export interface AiRunOperations {
  get(tenantId: string, id: string): AiRunRecord | null;
  findByIdempotencyKey(tenantId: string, key: string): AiRunRecord | null;
  start(input: CreateAiRunInput): AiRunRecord;
  retry(tenantId: string, id: string, input: unknown): AiRunRecord;
  complete(tenantId: string, id: string, output: unknown, explanation?: string): AiRunRecord;
  fail(tenantId: string, id: string, error: string): AiRunRecord;
}

export function createAiRunOperations(runtime: StoreRuntime): AiRunOperations {
  const get = (tenantId: string, id: string) => {
    const row = runtime.executor.select().from(aiRuns).where(and(eq(aiRuns.workspaceId, tenantId), eq(aiRuns.id, id))).get();
    return row ? mapAiRun(row) : null;
  };
  return {
    get,
    findByIdempotencyKey(tenantId, key) {
      const row = runtime.executor.select().from(aiRuns).where(and(eq(aiRuns.workspaceId, tenantId), eq(aiRuns.idempotencyKey, key))).get();
      return row ? mapAiRun(row) : null;
    },
    start(input) {
      return atomic(runtime, (tx) => {
        const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
        if (input.idempotencyKey) {
          const existing = tx.select().from(aiRuns).where(and(eq(aiRuns.workspaceId, tenantId), eq(aiRuns.idempotencyKey, input.idempotencyKey))).get();
          if (existing) return mapAiRun(existing);
        }
        const row = tx.insert(aiRuns).values({
          id: input.id ?? randomUUID(),
          workspaceId: tenantId,
          purpose: input.purpose,
          status: 'running',
          provider: input.provider,
          model: input.model,
          inputJson: encodeJson(input.input),
          idempotencyKey: input.idempotencyKey ?? null,
          createdAt: runtime.now().toISOString(),
        }).returning().get();
        const record = mapAiRun(row);
        appendEvent(tx, { tenantId, aggregateType: 'ai_run', aggregateId: row.id, type: 'ai_run.started', actor: { type: 'system' }, after: record }, runtime.now);
        return record;
      });
    },
    retry(tenantId, id, input) {
      return atomic(runtime, (tx) => {
        const existing = tx
          .select()
          .from(aiRuns)
          .where(and(eq(aiRuns.workspaceId, tenantId), eq(aiRuns.id, id)))
          .get();
        if (!existing) throw new NotFoundError('ai_run', id);
        if (existing.status === 'running') return mapAiRun(existing);
        if (existing.status !== 'failed') {
          throw new InvalidMutationError(`Cannot retry AI run in ${existing.status} status`);
        }
        const row = tx
          .update(aiRuns)
          .set({
            status: 'running',
            inputJson: encodeJson(input),
            outputJson: null,
            explanation: null,
            error: null,
            completedAt: null,
          })
          .where(and(eq(aiRuns.workspaceId, tenantId), eq(aiRuns.id, id)))
          .returning()
          .get();
        const record = mapAiRun(row);
        appendEvent(
          tx,
          {
            tenantId,
            aggregateType: 'ai_run',
            aggregateId: id,
            type: 'ai_run.retried',
            actor: { type: 'system' },
            before: mapAiRun(existing),
            after: record,
          },
          runtime.now,
        );
        return record;
      });
    },
    complete(tenantId, id, output, explanation) {
      return atomic(runtime, (tx) => {
        const existing = tx.select().from(aiRuns).where(and(eq(aiRuns.workspaceId, tenantId), eq(aiRuns.id, id))).get();
        if (!existing) throw new NotFoundError('ai_run', id);
        const row = tx.update(aiRuns).set({ status: 'completed', outputJson: encodeJson(output), explanation: explanation ?? null, completedAt: runtime.now().toISOString() }).where(eq(aiRuns.id, id)).returning().get();
        const record = mapAiRun(row);
        appendEvent(tx, { tenantId, aggregateType: 'ai_run', aggregateId: id, type: 'ai_run.completed', actor: { type: 'ai' }, before: mapAiRun(existing), after: record }, runtime.now);
        return record;
      });
    },
    fail(tenantId, id, error) {
      return atomic(runtime, (tx) => {
        const existing = tx.select().from(aiRuns).where(and(eq(aiRuns.workspaceId, tenantId), eq(aiRuns.id, id))).get();
        if (!existing) throw new NotFoundError('ai_run', id);
        const row = tx.update(aiRuns).set({ status: 'failed', error, completedAt: runtime.now().toISOString() }).where(and(eq(aiRuns.workspaceId, tenantId), eq(aiRuns.id, id))).returning().get();
        const record = mapAiRun(row);
        appendEvent(tx, { tenantId, aggregateType: 'ai_run', aggregateId: id, type: 'ai_run.failed', actor: { type: 'ai' }, before: mapAiRun(existing), after: record }, runtime.now);
        return record;
      });
    },
  };
}
