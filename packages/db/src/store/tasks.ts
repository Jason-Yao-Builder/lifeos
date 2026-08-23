import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray, isNull, like, lte, max, or, type SQL } from 'drizzle-orm';
import { InvalidMutationError, NotFoundError, VersionConflictError } from '../errors.js';
import { encodeJson } from '../json.js';
import { events, tasks } from '../schema.js';
import type {
  ActorInput,
  CreateTaskInput,
  EventRecord,
  TaskListFilters,
  TaskRecord,
  UpdateTaskPatch,
} from '../types.js';
import { DEFAULT_TENANT_ID, DEFAULT_USER_ID } from '../types.js';
import { appendEvent } from './events.js';
import { mapEvent, mapTask } from './mappers.js';
import { atomic, type StoreRuntime } from './runtime.js';

export interface TaskOperations {
  list(filters?: TaskListFilters): TaskRecord[];
  get(tenantId: string, id: string): TaskRecord | null;
  create(input: CreateTaskInput, actor?: ActorInput): TaskRecord;
  update(
    tenantId: string,
    id: string,
    expectedVersion: number,
    patch: UpdateTaskPatch,
    actor?: ActorInput,
  ): TaskRecord;
  softDelete(
    tenantId: string,
    id: string,
    expectedVersion: number,
    actor?: ActorInput,
  ): TaskRecord;
  reorder(tenantId: string, orderedIds: string[], actor?: ActorInput): TaskRecord[];
  events(tenantId: string, taskId: string): EventRecord[];
}

export function createTaskOperations(runtime: StoreRuntime): TaskOperations {
  const get = (tenantId: string, id: string): TaskRecord | null => {
    const row = runtime.executor
      .select()
      .from(tasks)
      .where(and(eq(tasks.workspaceId, tenantId), eq(tasks.id, id), isNull(tasks.deletedAt)))
      .get();
    return row ? mapTask(row) : null;
  };

  return {
    list(filters = {}) {
      const tenantId = filters.tenantId ?? DEFAULT_TENANT_ID;
      const conditions: SQL[] = [eq(tasks.workspaceId, tenantId), isNull(tasks.deletedAt)];
      if (filters.temperature) conditions.push(eq(tasks.temperature, filters.temperature));
      if (filters.status) conditions.push(eq(tasks.status, filters.status));
      if (filters.deadlineFrom) conditions.push(gte(tasks.deadlineAt, filters.deadlineFrom));
      if (filters.deadlineTo) conditions.push(lte(tasks.deadlineAt, filters.deadlineTo));
      if (filters.query) {
        const pattern = `%${filters.query}%`;
        conditions.push(or(like(tasks.title, pattern), like(tasks.description, pattern))!);
      }
      const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
      const offset = Math.max(filters.offset ?? 0, 0);
      const rows = runtime.executor
        .select()
        .from(tasks)
        .where(and(...conditions))
        .orderBy(asc(tasks.rank), asc(tasks.createdAt))
        .limit(filters.tag ? 500 : limit)
        .offset(filters.tag ? 0 : offset)
        .all()
        .map(mapTask);
      return filters.tag
        ? rows.filter((task) => task.tags.includes(filters.tag!)).slice(offset, offset + limit)
        : rows;
    },
    get,
    create(input, actor) {
      return atomic(runtime, (tx) => {
        const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
        const now = runtime.now().toISOString();
        const highestRank = tx
          .select({ value: max(tasks.rank) })
          .from(tasks)
          .where(and(eq(tasks.workspaceId, tenantId), isNull(tasks.deletedAt)))
          .get()?.value;
        const row = tx
          .insert(tasks)
          .values({
            id: input.id ?? randomUUID(),
            workspaceId: tenantId,
            ownerId: input.ownerId ?? DEFAULT_USER_ID,
            title: input.title,
            description: input.description ?? null,
            temperature: input.temperature ?? 'inspiration',
            status: input.status ?? 'todo',
            deadlineAt: input.deadline ?? null,
            plannedDate: input.plannedDate ?? null,
            startsAt: input.startAt ?? null,
            endsAt: input.endAt ?? null,
            estimatedMinutes: input.estimatedMinutes ?? null,
            actualMinutes: input.actualMinutes ?? 0,
            parentTaskId: input.parentTaskId ?? null,
            tagsJson: encodeJson(input.tags ?? [])!,
            scoreDimensionsJson: encodeJson(input.scoreDimensions),
            score: input.score ?? null,
            rank: input.rank ?? (highestRank ?? -1) + 1,
            completedAt: input.status === 'completed' ? now : null,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        const record = mapTask(row);
        appendEvent(tx, { tenantId, aggregateType: 'task', aggregateId: row.id, type: 'task.created', actor, after: record }, runtime.now);
        return record;
      });
    },
    update(tenantId, id, expectedVersion, patch, actor) {
      return atomic(runtime, (tx) => {
        const beforeRow = tx
          .select()
          .from(tasks)
          .where(and(eq(tasks.workspaceId, tenantId), eq(tasks.id, id), isNull(tasks.deletedAt)))
          .get();
        if (!beforeRow) throw new NotFoundError('task', id);
        if (beforeRow.version !== expectedVersion) throw new VersionConflictError('task', id);
        if (Object.keys(patch).length === 0) {
          throw new InvalidMutationError('Task patch must change at least one field');
        }
        const now = runtime.now().toISOString();
        const values: Record<string, unknown> = {
          updatedAt: now,
          version: expectedVersion + 1,
        };
        if ('title' in patch) values.title = patch.title;
        if ('description' in patch) values.description = patch.description;
        if ('temperature' in patch) values.temperature = patch.temperature;
        if ('status' in patch) {
          values.status = patch.status;
          values.completedAt = patch.status === 'completed'
            ? now
            : patch.status === 'todo' || patch.status === 'in_progress'
              ? null
              : beforeRow.completedAt;
        }
        if ('deadline' in patch) values.deadlineAt = patch.deadline;
        if ('plannedDate' in patch) values.plannedDate = patch.plannedDate;
        if ('startAt' in patch) values.startsAt = patch.startAt;
        if ('endAt' in patch) values.endsAt = patch.endAt;
        if ('estimatedMinutes' in patch) values.estimatedMinutes = patch.estimatedMinutes;
        if ('actualMinutes' in patch) values.actualMinutes = patch.actualMinutes;
        if ('parentTaskId' in patch) values.parentTaskId = patch.parentTaskId;
        if ('tags' in patch) values.tagsJson = encodeJson(patch.tags);
        if ('scoreDimensions' in patch) {
          values.scoreDimensionsJson = encodeJson(patch.scoreDimensions);
        }
        if ('score' in patch) values.score = patch.score;
        if ('rank' in patch) values.rank = patch.rank;
        const updated = tx
          .update(tasks)
          .set(values)
          .where(
            and(
              eq(tasks.workspaceId, tenantId),
              eq(tasks.id, id),
              eq(tasks.version, expectedVersion),
            ),
          )
          .returning()
          .get();
        if (!updated) throw new VersionConflictError('task', id);
        const before = mapTask(beforeRow);
        const after = mapTask(updated);
        appendEvent(tx, { tenantId, aggregateType: 'task', aggregateId: id, type: 'task.updated', actor, before, after }, runtime.now);
        return after;
      });
    },
    softDelete(tenantId, id, expectedVersion, actor) {
      return atomic(runtime, (tx) => {
        const beforeRow = tx
          .select()
          .from(tasks)
          .where(and(eq(tasks.workspaceId, tenantId), eq(tasks.id, id), isNull(tasks.deletedAt)))
          .get();
        if (!beforeRow) throw new NotFoundError('task', id);
        if (beforeRow.version !== expectedVersion) throw new VersionConflictError('task', id);
        const now = runtime.now().toISOString();
        const updated = tx
          .update(tasks)
          .set({ status: 'archived', deletedAt: now, updatedAt: now, version: expectedVersion + 1 })
          .where(and(eq(tasks.id, id), eq(tasks.version, expectedVersion)))
          .returning()
          .get();
        if (!updated) throw new VersionConflictError('task', id);
        const before = mapTask(beforeRow);
        const after = mapTask(updated);
        appendEvent(tx, { tenantId, aggregateType: 'task', aggregateId: id, type: 'task.deleted', actor, before, after }, runtime.now);
        return after;
      });
    },
    reorder(tenantId, orderedIds, actor) {
      return atomic(runtime, (tx) => {
        if (new Set(orderedIds).size !== orderedIds.length) {
          throw new InvalidMutationError('Task reorder contains duplicate ids');
        }
        const rows = orderedIds.length === 0
          ? []
          : tx.select().from(tasks).where(and(eq(tasks.workspaceId, tenantId), inArray(tasks.id, orderedIds), isNull(tasks.deletedAt))).all();
        if (rows.length !== orderedIds.length) {
          throw new InvalidMutationError('Task reorder contains an unknown task');
        }
        const byId = new Map(rows.map((row) => [row.id, row]));
        return orderedIds.map((id, rank) => {
          const beforeRow = byId.get(id)!;
          const updated = tx.update(tasks).set({ rank, version: beforeRow.version + 1, updatedAt: runtime.now().toISOString() }).where(and(eq(tasks.id, id), eq(tasks.version, beforeRow.version))).returning().get();
          if (!updated) throw new VersionConflictError('task', id);
          const before = mapTask(beforeRow);
          const after = mapTask(updated);
          appendEvent(tx, { tenantId, aggregateType: 'task', aggregateId: id, type: 'task.reordered', actor, before, after, metadata: { rank } }, runtime.now);
          return after;
        });
      });
    },
    events(tenantId, taskId) {
      return runtime.executor.select().from(events).where(and(eq(events.workspaceId, tenantId), eq(events.aggregateType, 'task'), eq(events.aggregateId, taskId))).orderBy(events.createdAt).all().map(mapEvent);
    },
  };
}
