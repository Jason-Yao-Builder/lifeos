import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, max, type SQL } from 'drizzle-orm';
import { InvalidMutationError, NotFoundError } from '../errors.js';
import { goals, tasks } from '../schema.js';
import type {
  ActorInput,
  CreateGoalInput,
  GoalListFilters,
  GoalProgress,
  GoalRecord,
  TaskRecord,
  UpdateGoalPatch,
} from '../types.js';
import { DEFAULT_TENANT_ID, DEFAULT_USER_ID } from '../types.js';
import { appendEvent } from './events.js';
import { mapGoal, mapTask } from './mappers.js';
import { atomic, type StoreRuntime } from './runtime.js';

export interface GoalOperations {
  list(filters?: GoalListFilters): GoalRecord[];
  get(tenantId: string, id: string): GoalRecord | null;
  create(input: CreateGoalInput, actor?: ActorInput): GoalRecord;
  update(tenantId: string, id: string, patch: UpdateGoalPatch, actor?: ActorInput): GoalRecord;
  softDelete(tenantId: string, id: string, actor?: ActorInput): GoalRecord;
  tasks(tenantId: string, id: string): TaskRecord[];
  progress(tenantId: string, id: string): GoalProgress;
}

export function createGoalOperations(runtime: StoreRuntime): GoalOperations {
  const get = (tenantId: string, id: string): GoalRecord | null => {
    const row = runtime.executor
      .select()
      .from(goals)
      .where(and(eq(goals.workspaceId, tenantId), eq(goals.id, id), isNull(goals.deletedAt)))
      .get();
    return row ? mapGoal(row) : null;
  };

  const goalTasks = (tenantId: string, id: string): TaskRecord[] => {
    if (!get(tenantId, id)) throw new NotFoundError('goal', id);
    return runtime.executor
      .select()
      .from(tasks)
      .where(and(eq(tasks.workspaceId, tenantId), eq(tasks.goalId, id), isNull(tasks.deletedAt)))
      .orderBy(asc(tasks.rank), asc(tasks.createdAt))
      .all()
      .map(mapTask);
  };

  return {
    list(filters = {}) {
      const tenantId = filters.tenantId ?? DEFAULT_TENANT_ID;
      const conditions: SQL[] = [eq(goals.workspaceId, tenantId), isNull(goals.deletedAt)];
      if (filters.status) conditions.push(eq(goals.status, filters.status));
      return runtime.executor
        .select()
        .from(goals)
        .where(and(...conditions))
        .orderBy(asc(goals.rank), asc(goals.createdAt))
        .limit(Math.min(Math.max(filters.limit ?? 100, 1), 500))
        .offset(Math.max(filters.offset ?? 0, 0))
        .all()
        .map(mapGoal);
    },
    get,
    create(input, actor) {
      return atomic(runtime, (tx) => {
        const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
        const now = runtime.now().toISOString();
        const highestRank = tx
          .select({ value: max(goals.rank) })
          .from(goals)
          .where(and(eq(goals.workspaceId, tenantId), isNull(goals.deletedAt)))
          .get()?.value;
        const row = tx
          .insert(goals)
          .values({
            id: input.id ?? randomUUID(),
            workspaceId: tenantId,
            ownerId: input.ownerId ?? DEFAULT_USER_ID,
            title: input.title,
            description: input.description ?? null,
            timeframe: input.timeframe ?? null,
            status: input.status ?? 'active',
            rank: input.rank ?? (highestRank ?? -1) + 1,
            createdAt: now,
            updatedAt: now,
            completedAt: input.status === 'completed' ? now : null,
          })
          .returning()
          .get();
        const record = mapGoal(row);
        appendEvent(tx, {
          tenantId,
          aggregateType: 'goal',
          aggregateId: row.id,
          type: 'goal.created',
          actor,
          after: record,
        }, runtime.now);
        return record;
      });
    },
    update(tenantId, id, patch, actor) {
      return atomic(runtime, (tx) => {
        const beforeRow = tx
          .select()
          .from(goals)
          .where(and(eq(goals.workspaceId, tenantId), eq(goals.id, id), isNull(goals.deletedAt)))
          .get();
        if (!beforeRow) throw new NotFoundError('goal', id);
        if (Object.keys(patch).length === 0) {
          throw new InvalidMutationError('Goal patch must change at least one field');
        }
        const now = runtime.now().toISOString();
        const values: Partial<typeof goals.$inferInsert> = { updatedAt: now };
        if ('title' in patch) values.title = patch.title;
        if ('description' in patch) values.description = patch.description;
        if ('timeframe' in patch) values.timeframe = patch.timeframe;
        if ('rank' in patch) values.rank = patch.rank;
        if ('status' in patch) {
          values.status = patch.status;
          values.completedAt = patch.status === 'completed' ? now : null;
        }
        const row = tx.update(goals).set(values).where(eq(goals.id, id)).returning().get();
        const before = mapGoal(beforeRow);
        const after = mapGoal(row);
        appendEvent(tx, {
          tenantId,
          aggregateType: 'goal',
          aggregateId: id,
          type: 'goal.updated',
          actor,
          before,
          after,
        }, runtime.now);
        return after;
      });
    },
    softDelete(tenantId, id, actor) {
      return atomic(runtime, (tx) => {
        const beforeRow = tx
          .select()
          .from(goals)
          .where(and(eq(goals.workspaceId, tenantId), eq(goals.id, id), isNull(goals.deletedAt)))
          .get();
        if (!beforeRow) throw new NotFoundError('goal', id);
        const now = runtime.now().toISOString();
        const row = tx
          .update(goals)
          .set({ deletedAt: now, updatedAt: now })
          .where(eq(goals.id, id))
          .returning()
          .get();
        const before = mapGoal(beforeRow);
        const after = mapGoal(row);
        appendEvent(tx, {
          tenantId,
          aggregateType: 'goal',
          aggregateId: id,
          type: 'goal.deleted',
          actor,
          before,
          after,
        }, runtime.now);
        return after;
      });
    },
    tasks: goalTasks,
    progress(tenantId, id) {
      const records = goalTasks(tenantId, id);
      const completed = records.filter(
        (task) => task.status === 'completed' || task.completedAt !== null,
      ).length;
      const byTemperature = {
        inspiration: 0,
        cold: 0,
        warm: 0,
        hot: 0,
      };
      for (const task of records) byTemperature[task.temperature] += 1;
      return {
        completed,
        total: records.length,
        percent: records.length === 0 ? 0 : Math.round((completed / records.length) * 100),
        byTemperature,
      };
    },
  };
}
