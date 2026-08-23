import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { InvalidMutationError, NotFoundError, VersionConflictError } from '../errors.js';
import { encodeJson } from '../json.js';
import { rules } from '../schema.js';
import type { ActorInput, CreateRuleInput, RuleRecord, UpdateRulePatch } from '../types.js';
import { DEFAULT_TENANT_ID } from '../types.js';
import { appendEvent } from './events.js';
import { mapRule } from './mappers.js';
import { atomic, type StoreRuntime } from './runtime.js';

export interface RuleOperations {
  list(tenantId?: string, enabled?: boolean): RuleRecord[];
  create(input: CreateRuleInput, actor?: ActorInput): RuleRecord;
  update(
    tenantId: string,
    id: string,
    expectedVersion: number,
    patch: UpdateRulePatch,
    actor?: ActorInput,
  ): RuleRecord;
}

export function createRuleOperations(runtime: StoreRuntime): RuleOperations {
  return {
    list(tenantId = DEFAULT_TENANT_ID, enabled) {
      const where = enabled === undefined
        ? eq(rules.workspaceId, tenantId)
        : and(eq(rules.workspaceId, tenantId), eq(rules.enabled, enabled));
      return runtime.executor.select().from(rules).where(where).orderBy(asc(rules.name)).all().map(mapRule);
    },
    create(input, actor) {
      return atomic(runtime, (tx) => {
        const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
        const now = runtime.now().toISOString();
        const row = tx.insert(rules).values({
          id: input.id ?? randomUUID(),
          workspaceId: tenantId,
          name: input.name,
          enabled: input.enabled ?? true,
          triggerJson: encodeJson(input.trigger)!,
          conditionJson: encodeJson(input.condition)!,
          actionJson: encodeJson(input.action)!,
          configJson: encodeJson(input.config ?? {})!,
          createdAt: now,
          updatedAt: now,
        }).returning().get();
        const record = mapRule(row);
        appendEvent(tx, { tenantId, aggregateType: 'rule', aggregateId: row.id, type: 'rule.created', actor, after: record }, runtime.now);
        return record;
      });
    },
    update(tenantId, id, expectedVersion, patch, actor) {
      return atomic(runtime, (tx) => {
        const beforeRow = tx.select().from(rules).where(and(eq(rules.workspaceId, tenantId), eq(rules.id, id))).get();
        if (!beforeRow) throw new NotFoundError('rule', id);
        if (beforeRow.version !== expectedVersion) throw new VersionConflictError('rule', id);
        if (Object.keys(patch).length === 0) throw new InvalidMutationError('Rule patch must not be empty');
        const values: Record<string, unknown> = { updatedAt: runtime.now().toISOString(), version: expectedVersion + 1 };
        if ('name' in patch) values.name = patch.name;
        if ('enabled' in patch) values.enabled = patch.enabled;
        if ('trigger' in patch) values.triggerJson = encodeJson(patch.trigger);
        if ('condition' in patch) values.conditionJson = encodeJson(patch.condition);
        if ('action' in patch) values.actionJson = encodeJson(patch.action);
        if ('config' in patch) values.configJson = encodeJson(patch.config);
        const updated = tx.update(rules).set(values).where(and(eq(rules.id, id), eq(rules.version, expectedVersion))).returning().get();
        if (!updated) throw new VersionConflictError('rule', id);
        const before = mapRule(beforeRow);
        const after = mapRule(updated);
        appendEvent(tx, { tenantId, aggregateType: 'rule', aggregateId: id, type: 'rule.updated', actor, before, after }, runtime.now);
        return after;
      });
    },
  };
}
