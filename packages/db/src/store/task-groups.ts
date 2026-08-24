import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { ConflictError, InvalidMutationError, NotFoundError } from '../errors.js';
import { taskGroups } from '../schema.js';
import type {
  ActorInput,
  CreateTaskGroupInput,
  TaskGroupRecord,
  UpdateTaskGroupPatch,
} from '../types.js';
import { DEFAULT_WORKSPACE_ID } from '../types.js';
import { appendEvent } from './events.js';
import { mapTaskGroup } from './mappers.js';
import { atomic, type StoreExecutor, type StoreRuntime } from './runtime.js';

export interface TaskGroupOperations {
  list(workspaceId?: string): TaskGroupRecord[];
  get(workspaceId: string, id: string): TaskGroupRecord | null;
  create(input: CreateTaskGroupInput, actor?: ActorInput): TaskGroupRecord;
  update(
    workspaceId: string,
    id: string,
    patch: UpdateTaskGroupPatch,
    actor?: ActorInput,
  ): TaskGroupRecord;
}

function normalizedName(name: string): { name: string; key: string } {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 100) {
    throw new InvalidMutationError('Task group name must contain 1 to 100 characters');
  }
  return { name: trimmed, key: trimmed.toLowerCase() };
}

function normalizedColor(color: string): string {
  const normalized = color.toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(normalized)) {
    throw new InvalidMutationError('Task group color must use #RRGGBB format');
  }
  return normalized;
}

function assertUniqueName(
  executor: StoreExecutor,
  workspaceId: string,
  key: string,
  excludingId?: string,
): void {
  const existing = executor
    .select({ id: taskGroups.id })
    .from(taskGroups)
    .where(and(eq(taskGroups.workspaceId, workspaceId), eq(taskGroups.normalizedName, key)))
    .get();
  if (existing && existing.id !== excludingId) {
    throw new ConflictError('Task group name already exists in this workspace');
  }
}

export function createTaskGroupOperations(runtime: StoreRuntime): TaskGroupOperations {
  const get = (workspaceId: string, id: string): TaskGroupRecord | null => {
    const row = runtime.executor
      .select()
      .from(taskGroups)
      .where(and(eq(taskGroups.workspaceId, workspaceId), eq(taskGroups.id, id)))
      .get();
    return row ? mapTaskGroup(row) : null;
  };

  return {
    list(workspaceId = DEFAULT_WORKSPACE_ID) {
      return runtime.executor
        .select()
        .from(taskGroups)
        .where(eq(taskGroups.workspaceId, workspaceId))
        .orderBy(asc(taskGroups.createdAt), asc(taskGroups.name), asc(taskGroups.id))
        .all()
        .map(mapTaskGroup);
    },
    get,
    create(input, actor) {
      return atomic(runtime, (tx) => {
        const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
        const normalized = normalizedName(input.name);
        const color = normalizedColor(input.color);
        assertUniqueName(tx, workspaceId, normalized.key);
        const now = runtime.now().toISOString();
        const row = tx
          .insert(taskGroups)
          .values({
            id: input.id ?? randomUUID(),
            workspaceId,
            name: normalized.name,
            normalizedName: normalized.key,
            color,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        const record = mapTaskGroup(row);
        appendEvent(tx, {
          tenantId: workspaceId,
          aggregateType: 'task_group',
          aggregateId: row.id,
          type: 'task_group.created',
          actor,
          after: record,
        }, runtime.now);
        return record;
      });
    },
    update(workspaceId, id, patch, actor) {
      return atomic(runtime, (tx) => {
        const beforeRow = tx
          .select()
          .from(taskGroups)
          .where(and(eq(taskGroups.workspaceId, workspaceId), eq(taskGroups.id, id)))
          .get();
        if (!beforeRow) throw new NotFoundError('task_group', id);
        if (Object.keys(patch).length === 0) {
          throw new InvalidMutationError('Task group patch must change at least one field');
        }
        const values: Partial<typeof taskGroups.$inferInsert> = {
          updatedAt: runtime.now().toISOString(),
        };
        if ('name' in patch && patch.name !== undefined) {
          const normalized = normalizedName(patch.name);
          assertUniqueName(tx, workspaceId, normalized.key, id);
          values.name = normalized.name;
          values.normalizedName = normalized.key;
        }
        if ('color' in patch && patch.color !== undefined) {
          values.color = normalizedColor(patch.color);
        }
        const row = tx
          .update(taskGroups)
          .set(values)
          .where(and(eq(taskGroups.workspaceId, workspaceId), eq(taskGroups.id, id)))
          .returning()
          .get();
        if (!row) throw new NotFoundError('task_group', id);
        const before = mapTaskGroup(beforeRow);
        const after = mapTaskGroup(row);
        appendEvent(tx, {
          tenantId: workspaceId,
          aggregateType: 'task_group',
          aggregateId: id,
          type: 'task_group.updated',
          actor,
          before,
          after,
        }, runtime.now);
        return after;
      });
    },
  };
}
