import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, isNull, like, lte, max, or, sql, type SQL } from 'drizzle-orm';
import { InvalidMutationError, NotFoundError, VersionConflictError } from '../errors.js';
import { encodeJson } from '../json.js';
import { events, goals, repeatTemplates, taskGroups, tasks } from '../schema.js';
import type {
  ActorInput,
  CreateTaskInput,
  DateRangeFilters,
  EventRecord,
  TaskListFilters,
  TaskProgress,
  TaskRecord,
  UpdateTaskPatch,
} from '../types.js';
import { DEFAULT_TENANT_ID, DEFAULT_USER_ID } from '../types.js';
import { appendEvent } from './events.js';
import { mapEvent, mapTask } from './mappers.js';
import { atomic, type StoreExecutor, type StoreRuntime } from './runtime.js';

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
  inheritParentAttributes(
    tenantId: string,
    id: string,
    expectedVersion: number,
    actor?: ActorInput,
  ): TaskRecord;
  softDelete(
    tenantId: string,
    id: string,
    expectedVersion: number,
    actor?: ActorInput,
  ): TaskRecord;
  reorder(tenantId: string, orderedIds: string[], actor?: ActorInput): TaskRecord[];
  reorderSubtasks(
    tenantId: string,
    parentId: string,
    orderedIds: string[],
    actor?: ActorInput,
  ): TaskRecord[];
  events(tenantId: string, taskId: string): EventRecord[];
  listSubtasks(tenantId: string, parentId: string): TaskRecord[];
  progress(tenantId: string, parentId: string): TaskProgress;
  listCalendar(filters: DateRangeFilters): TaskRecord[];
  listGantt(filters: DateRangeFilters): TaskRecord[];
}

function assertTaskAssociations(
  executor: StoreExecutor,
  tenantId: string,
  input: Pick<CreateTaskInput, 'parentTaskId' | 'goalId' | 'repeatTemplateId' | 'groupId'>,
  taskId?: string,
): void {
  if (input.groupId) {
    const group = executor
      .select({ id: taskGroups.id })
      .from(taskGroups)
      .where(and(eq(taskGroups.workspaceId, tenantId), eq(taskGroups.id, input.groupId)))
      .get();
    if (!group) throw new NotFoundError('task_group', input.groupId);
  }
  if (input.goalId) {
    const goal = executor
      .select({ id: goals.id })
      .from(goals)
      .where(
        and(eq(goals.workspaceId, tenantId), eq(goals.id, input.goalId), isNull(goals.deletedAt)),
      )
      .get();
    if (!goal) throw new NotFoundError('goal', input.goalId);
  }
  if (input.repeatTemplateId) {
    const template = executor
      .select({ id: repeatTemplates.id })
      .from(repeatTemplates)
      .where(
        and(
          eq(repeatTemplates.workspaceId, tenantId),
          eq(repeatTemplates.id, input.repeatTemplateId),
          isNull(repeatTemplates.deletedAt),
        ),
      )
      .get();
    if (!template) throw new NotFoundError('repeat_template', input.repeatTemplateId);
  }
  if (!input.parentTaskId) return;
  if (input.parentTaskId === taskId) {
    throw new InvalidMutationError('A task cannot be its own parent');
  }
  let parentId: string | null = input.parentTaskId;
  const visited = new Set<string>();
  while (parentId) {
    if (visited.has(parentId) || parentId === taskId) {
      throw new InvalidMutationError('Task parent would create a cycle');
    }
    visited.add(parentId);
    const parent: { parentTaskId: string | null } | undefined = executor
      .select({ parentTaskId: tasks.parentTaskId })
      .from(tasks)
      .where(
        and(eq(tasks.workspaceId, tenantId), eq(tasks.id, parentId), isNull(tasks.deletedAt)),
      )
      .get();
    if (!parent) throw new NotFoundError('task', parentId);
    parentId = parent.parentTaskId;
  }
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
      if (filters.goalId) conditions.push(eq(tasks.goalId, filters.goalId));
      if (filters.repeatTemplateId) {
        conditions.push(eq(tasks.repeatTemplateId, filters.repeatTemplateId));
      }
      if (filters.parentTaskId === null) conditions.push(isNull(tasks.parentTaskId));
      if (typeof filters.parentTaskId === 'string') {
        conditions.push(eq(tasks.parentTaskId, filters.parentTaskId));
      }
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
        assertTaskAssociations(tx, tenantId, input);
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
            groupId: input.groupId ?? null,
            parentTaskId: input.parentTaskId ?? null,
            goalId: input.goalId ?? null,
            repeatTemplateId: input.repeatTemplateId ?? null,
            plannedStartTime: input.plannedStartTime ?? null,
            plannedEndTime: input.plannedEndTime ?? null,
            carryOverFrom: input.carryOverFrom ?? null,
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
        assertTaskAssociations(tx, tenantId, patch, id);
        const now = runtime.now().toISOString();
        const entersCompleted = patch.status === 'completed' && beforeRow.status !== 'completed';
        const highestRank = entersCompleted
          ? tx
              .select({ value: max(tasks.rank) })
              .from(tasks)
              .where(and(eq(tasks.workspaceId, tenantId), isNull(tasks.deletedAt)))
              .get()?.value
          : null;
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
        if ('groupId' in patch) values.groupId = patch.groupId;
        if ('parentTaskId' in patch) values.parentTaskId = patch.parentTaskId;
        if ('goalId' in patch) values.goalId = patch.goalId;
        if ('repeatTemplateId' in patch) values.repeatTemplateId = patch.repeatTemplateId;
        if ('plannedStartTime' in patch) values.plannedStartTime = patch.plannedStartTime;
        if ('plannedEndTime' in patch) values.plannedEndTime = patch.plannedEndTime;
        if ('carryOverFrom' in patch) values.carryOverFrom = patch.carryOverFrom;
        if ('tags' in patch) values.tagsJson = encodeJson(patch.tags);
        if ('scoreDimensions' in patch) {
          values.scoreDimensionsJson = encodeJson(patch.scoreDimensions);
        }
        if ('score' in patch) values.score = patch.score;
        if ('rank' in patch) values.rank = patch.rank;
        if (entersCompleted) values.rank = (highestRank ?? -1) + 1;
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
    inheritParentAttributes(tenantId, id, expectedVersion, actor) {
      return atomic(runtime, (tx) => {
        const beforeRow = tx
          .select()
          .from(tasks)
          .where(and(eq(tasks.workspaceId, tenantId), eq(tasks.id, id), isNull(tasks.deletedAt)))
          .get();
        if (!beforeRow) throw new NotFoundError('task', id);
        if (beforeRow.version !== expectedVersion) throw new VersionConflictError('task', id);
        if (!beforeRow.parentTaskId) {
          throw new InvalidMutationError('Only a subtask can inherit parent attributes');
        }
        const parentRow = tx
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.workspaceId, tenantId),
              eq(tasks.id, beforeRow.parentTaskId),
              isNull(tasks.deletedAt),
            ),
          )
          .get();
        if (!parentRow) throw new NotFoundError('task', beforeRow.parentTaskId);
        const updated = tx
          .update(tasks)
          .set({
            groupId: parentRow.groupId,
            tagsJson: parentRow.tagsJson,
            scoreDimensionsJson: parentRow.scoreDimensionsJson,
            score: parentRow.score,
            updatedAt: runtime.now().toISOString(),
            version: expectedVersion + 1,
          })
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
        appendEvent(
          tx,
          {
            tenantId,
            aggregateType: 'task',
            aggregateId: id,
            type: 'task.parent_inherited',
            actor,
            before,
            after,
          },
          runtime.now,
        );
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
        const rows = tx
          .select()
          .from(tasks)
          .where(and(eq(tasks.workspaceId, tenantId), isNull(tasks.deletedAt)))
          .all();
        const byId = new Map(rows.map((row) => [row.id, row]));
        if (
          rows.length !== orderedIds.length ||
          orderedIds.some((id) => !byId.has(id))
        ) {
          throw new InvalidMutationError('Task reorder must contain every active task exactly once');
        }
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
    reorderSubtasks(tenantId, parentId, orderedIds, actor) {
      return atomic(runtime, (tx) => {
        const parent = tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(
            and(
              eq(tasks.workspaceId, tenantId),
              eq(tasks.id, parentId),
              isNull(tasks.deletedAt),
            ),
          )
          .get();
        if (!parent) throw new NotFoundError('task', parentId);
        if (new Set(orderedIds).size !== orderedIds.length) {
          throw new InvalidMutationError('Subtask reorder contains duplicate ids');
        }
        const rows = tx
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.workspaceId, tenantId),
              eq(tasks.parentTaskId, parentId),
              isNull(tasks.deletedAt),
            ),
          )
          .orderBy(asc(tasks.rank), asc(tasks.createdAt), asc(tasks.id))
          .all();
        const byId = new Map(rows.map((row) => [row.id, row]));
        if (
          rows.length !== orderedIds.length ||
          orderedIds.some((id) => !byId.has(id))
        ) {
          throw new InvalidMutationError(
            'Subtask reorder must contain every active direct child exactly once',
          );
        }
        const rankSlots = rows.map((row) => row.rank);
        const now = runtime.now().toISOString();
        return orderedIds.map((id, index) => {
          const beforeRow = byId.get(id)!;
          const rank = rankSlots[index]!;
          if (beforeRow.rank === rank) return mapTask(beforeRow);
          const updated = tx
            .update(tasks)
            .set({ rank, version: beforeRow.version + 1, updatedAt: now })
            .where(
              and(
                eq(tasks.workspaceId, tenantId),
                eq(tasks.id, id),
                eq(tasks.parentTaskId, parentId),
                isNull(tasks.deletedAt),
                eq(tasks.version, beforeRow.version),
              ),
            )
            .returning()
            .get();
          if (!updated) throw new VersionConflictError('task', id);
          const before = mapTask(beforeRow);
          const after = mapTask(updated);
          appendEvent(
            tx,
            {
              tenantId,
              aggregateType: 'task',
              aggregateId: id,
              type: 'task.reordered',
              actor,
              before,
              after,
              metadata: { parentId, rank },
            },
            runtime.now,
          );
          return after;
        });
      });
    },
    listSubtasks(tenantId, parentId) {
      if (!get(tenantId, parentId)) throw new NotFoundError('task', parentId);
      return runtime.executor
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.workspaceId, tenantId),
            eq(tasks.parentTaskId, parentId),
            isNull(tasks.deletedAt),
          ),
        )
        .orderBy(asc(tasks.rank), asc(tasks.createdAt), asc(tasks.id))
        .all()
        .map(mapTask);
    },
    progress(tenantId, parentId) {
      if (!get(tenantId, parentId)) throw new NotFoundError('task', parentId);
      const rows = runtime.executor
        .select({ status: tasks.status, completedAt: tasks.completedAt })
        .from(tasks)
        .where(
          and(
            eq(tasks.workspaceId, tenantId),
            eq(tasks.parentTaskId, parentId),
            isNull(tasks.deletedAt),
          ),
        )
        .all();
      const completed = rows.filter(
        (row) => row.status === 'completed' || row.completedAt !== null,
      ).length;
      return {
        completed,
        total: rows.length,
        percent: rows.length === 0 ? 0 : Math.round((completed / rows.length) * 100),
      };
    },
    listCalendar(filters) {
      if (filters.start > filters.end) {
        throw new InvalidMutationError('Calendar range start must not be after end');
      }
      const tenantId = filters.tenantId ?? DEFAULT_TENANT_ID;
      const conditions: SQL[] = [
        eq(tasks.workspaceId, tenantId),
        isNull(tasks.deletedAt),
        sql`(
          ${tasks.plannedDate} between ${filters.start} and ${filters.end}
          or substr(${tasks.deadlineAt}, 1, 10)
            between date(${filters.start}, '-1 day') and date(${filters.end}, '+1 day')
        )`,
      ];
      if (filters.goalId) conditions.push(eq(tasks.goalId, filters.goalId));
      return runtime.executor
        .select()
        .from(tasks)
        .where(and(...conditions))
        .orderBy(asc(tasks.plannedDate), asc(tasks.rank), asc(tasks.createdAt))
        .all()
        .map(mapTask);
    },
    listGantt(filters) {
      if (filters.start > filters.end) {
        throw new InvalidMutationError('Gantt range start must not be after end');
      }
      const tenantId = filters.tenantId ?? DEFAULT_TENANT_ID;
      const conditions: SQL[] = [
        eq(tasks.workspaceId, tenantId),
        isNull(tasks.deletedAt),
        sql`(
          ${tasks.plannedDate} between ${filters.start} and ${filters.end}
          or (
            substr(coalesce(${tasks.startsAt}, ${tasks.deadlineAt}), 1, 10)
              <= date(${filters.end}, '+1 day')
            and substr(
              coalesce(${tasks.endsAt}, ${tasks.deadlineAt}, ${tasks.startsAt}),
              1,
              10
            ) >= date(${filters.start}, '-1 day')
          )
        )`,
      ];
      if (filters.goalId) conditions.push(eq(tasks.goalId, filters.goalId));
      return runtime.executor
        .select()
        .from(tasks)
        .where(and(...conditions))
        .orderBy(asc(tasks.rank), asc(tasks.createdAt), asc(tasks.id))
        .all()
        .map(mapTask);
    },
    events(tenantId, taskId) {
      return runtime.executor.select().from(events).where(and(eq(events.workspaceId, tenantId), eq(events.aggregateType, 'task'), eq(events.aggregateId, taskId))).orderBy(events.createdAt).all().map(mapEvent);
    },
  };
}
