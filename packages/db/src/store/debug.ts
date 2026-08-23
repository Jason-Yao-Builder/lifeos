import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { aiRuns, cards, events, rules, tasks } from '../schema.js';
import type { DebugStats, EventRecord } from '../types.js';
import { DEFAULT_TENANT_ID } from '../types.js';
import { mapEvent } from './mappers.js';
import type { StoreRuntime } from './runtime.js';

export interface DebugOperations {
  stats(tenantId?: string): DebugStats;
  recentEvents(tenantId?: string, limit?: number): EventRecord[];
}

export function createDebugOperations(runtime: StoreRuntime): DebugOperations {
  return {
    stats(tenantId = DEFAULT_TENANT_ID) {
      const activeTasks = and(eq(tasks.workspaceId, tenantId), isNull(tasks.deletedAt));
      const total = runtime.executor.select({ value: count() }).from(tasks).where(activeTasks).get()?.value ?? 0;
      const temperatureRows = runtime.executor
        .select({ key: tasks.temperature, value: count() })
        .from(tasks)
        .where(activeTasks)
        .groupBy(tasks.temperature)
        .all();
      const statusRows = runtime.executor
        .select({ key: tasks.status, value: count() })
        .from(tasks)
        .where(activeTasks)
        .groupBy(tasks.status)
        .all();
      const pendingCards = runtime.executor
        .select({ value: count() })
        .from(cards)
        .where(and(eq(cards.workspaceId, tenantId), eq(cards.status, 'pending')))
        .get()?.value ?? 0;
      const enabledRules = runtime.executor
        .select({ value: count() })
        .from(rules)
        .where(and(eq(rules.workspaceId, tenantId), eq(rules.enabled, true)))
        .get()?.value ?? 0;
      const failedAiRuns = runtime.executor
        .select({ value: count() })
        .from(aiRuns)
        .where(and(eq(aiRuns.workspaceId, tenantId), eq(aiRuns.status, 'failed')))
        .get()?.value ?? 0;
      return {
        tasks: {
          total,
          byTemperature: Object.fromEntries(temperatureRows.map((row) => [row.key, row.value])),
          byStatus: Object.fromEntries(statusRows.map((row) => [row.key, row.value])),
        },
        pendingCards,
        enabledRules,
        failedAiRuns,
      };
    },
    recentEvents(tenantId = DEFAULT_TENANT_ID, limit = 100) {
      return runtime.executor
        .select()
        .from(events)
        .where(eq(events.workspaceId, tenantId))
        .orderBy(desc(events.createdAt))
        .limit(Math.min(Math.max(limit, 1), 500))
        .all()
        .map(mapEvent);
    },
  };
}
