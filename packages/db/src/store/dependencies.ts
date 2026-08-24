import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import {
  DependencyCycleError,
  InvalidMutationError,
  NotFoundError,
} from '../errors.js';
import { taskDependencies, tasks } from '../schema.js';
import type {
  ActorInput,
  CreateTaskDependencyInput,
  TaskDependencies,
  TaskDependencyRecord,
} from '../types.js';
import { DEFAULT_TENANT_ID } from '../types.js';
import { appendEvent } from './events.js';
import { mapTaskDependency } from './mappers.js';
import { atomic, type StoreExecutor, type StoreRuntime } from './runtime.js';

export interface DependencyOperations {
  list(tenantId?: string): TaskDependencyRecord[];
  listForTask(tenantId: string, taskId: string): TaskDependencies;
  create(input: CreateTaskDependencyInput, actor?: ActorInput): TaskDependencyRecord;
  remove(tenantId: string, id: string, actor?: ActorInput): TaskDependencyRecord;
  isBlocked(tenantId: string, taskId: string): boolean;
  criticalPath(tenantId: string, taskIds?: string[]): string[];
}

function assertTask(executor: StoreExecutor, tenantId: string, id: string): void {
  const row = executor
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, tenantId), eq(tasks.id, id), isNull(tasks.deletedAt)))
    .get();
  if (!row) throw new NotFoundError('task', id);
}

function hasPath(edges: Array<{ predecessorId: string; successorId: string }>, from: string, to: string): boolean {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = outgoing.get(edge.predecessorId) ?? [];
    targets.push(edge.successorId);
    outgoing.set(edge.predecessorId, targets);
  }
  const pending = [from];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === to) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(outgoing.get(current) ?? []));
  }
  return false;
}

export function createDependencyOperations(runtime: StoreRuntime): DependencyOperations {
  const list = (tenantId = DEFAULT_TENANT_ID): TaskDependencyRecord[] =>
    runtime.executor
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.workspaceId, tenantId))
      .orderBy(taskDependencies.createdAt)
      .all()
      .map(mapTaskDependency);

  const isBlocked = (tenantId: string, taskId: string): boolean => {
    assertTask(runtime.executor, tenantId, taskId);
    const predecessors = runtime.executor
      .select({ status: tasks.status, completedAt: tasks.completedAt })
      .from(taskDependencies)
      .innerJoin(tasks, eq(taskDependencies.predecessorId, tasks.id))
      .where(
        and(
          eq(taskDependencies.workspaceId, tenantId),
          eq(taskDependencies.successorId, taskId),
          isNull(tasks.deletedAt),
        ),
      )
      .all();
    return predecessors.some(
      (row) => row.status !== 'completed' && row.completedAt === null,
    );
  };

  return {
    list,
    listForTask(tenantId, taskId) {
      assertTask(runtime.executor, tenantId, taskId);
      const rows = runtime.executor
        .select()
        .from(taskDependencies)
        .where(
          and(
            eq(taskDependencies.workspaceId, tenantId),
            or(
              eq(taskDependencies.predecessorId, taskId),
              eq(taskDependencies.successorId, taskId),
            ),
          ),
        )
        .orderBy(taskDependencies.createdAt)
        .all()
        .map(mapTaskDependency);
      return {
        predecessors: rows.filter((row) => row.successorId === taskId),
        successors: rows.filter((row) => row.predecessorId === taskId),
        isBlocked: isBlocked(tenantId, taskId),
      };
    },
    create(input, actor) {
      return atomic(runtime, (tx) => {
        const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
        if (input.predecessorId === input.successorId) {
          throw new InvalidMutationError('A task cannot depend on itself');
        }
        assertTask(tx, tenantId, input.predecessorId);
        assertTask(tx, tenantId, input.successorId);
        const duplicate = tx
          .select({ id: taskDependencies.id })
          .from(taskDependencies)
          .where(
            and(
              eq(taskDependencies.workspaceId, tenantId),
              eq(taskDependencies.predecessorId, input.predecessorId),
              eq(taskDependencies.successorId, input.successorId),
            ),
          )
          .get();
        if (duplicate) throw new InvalidMutationError('Dependency already exists');
        const existing = tx
          .select({
            predecessorId: taskDependencies.predecessorId,
            successorId: taskDependencies.successorId,
          })
          .from(taskDependencies)
          .where(eq(taskDependencies.workspaceId, tenantId))
          .all();
        if (hasPath(existing, input.successorId, input.predecessorId)) {
          throw new DependencyCycleError(input.predecessorId, input.successorId);
        }
        const row = tx
          .insert(taskDependencies)
          .values({
            id: input.id ?? randomUUID(),
            workspaceId: tenantId,
            predecessorId: input.predecessorId,
            successorId: input.successorId,
            type: input.type ?? 'finish_to_start',
            createdAt: runtime.now().toISOString(),
          })
          .returning()
          .get();
        const record = mapTaskDependency(row);
        appendEvent(tx, {
          tenantId,
          aggregateType: 'task_dependency',
          aggregateId: row.id,
          type: 'task_dependency.created',
          actor,
          after: record,
        }, runtime.now);
        return record;
      });
    },
    remove(tenantId, id, actor) {
      return atomic(runtime, (tx) => {
        const row = tx
          .select()
          .from(taskDependencies)
          .where(and(eq(taskDependencies.workspaceId, tenantId), eq(taskDependencies.id, id)))
          .get();
        if (!row) throw new NotFoundError('task_dependency', id);
        const record = mapTaskDependency(row);
        tx.delete(taskDependencies).where(eq(taskDependencies.id, id)).run();
        appendEvent(tx, {
          tenantId,
          aggregateType: 'task_dependency',
          aggregateId: id,
          type: 'task_dependency.deleted',
          actor,
          before: record,
        }, runtime.now);
        return record;
      });
    },
    isBlocked,
    criticalPath(tenantId, taskIds) {
      if (taskIds?.length === 0) return [];
      const conditions = [eq(tasks.workspaceId, tenantId), isNull(tasks.deletedAt)];
      if (taskIds) conditions.push(inArray(tasks.id, taskIds));
      const taskRows = runtime.executor
        .select({
          id: tasks.id,
          estimatedMinutes: tasks.estimatedMinutes,
          startsAt: tasks.startsAt,
          endsAt: tasks.endsAt,
        })
        .from(tasks)
        .where(and(...conditions))
        .all();
      const ids = new Set(taskRows.map((row) => row.id));
      if (ids.size === 0) return [];
      const edges = list(tenantId).filter(
        (edge) => ids.has(edge.predecessorId) && ids.has(edge.successorId),
      );
      const outgoing = new Map<string, string[]>();
      const indegree = new Map([...ids].map((id) => [id, 0]));
      for (const edge of edges) {
        outgoing.set(edge.predecessorId, [...(outgoing.get(edge.predecessorId) ?? []), edge.successorId]);
        indegree.set(edge.successorId, (indegree.get(edge.successorId) ?? 0) + 1);
      }
      const queue = [...ids].filter((id) => indegree.get(id) === 0);
      const weights = new Map(taskRows.map((row) => {
        const duration = row.startsAt && row.endsAt
          ? Math.round((Date.parse(row.endsAt) - Date.parse(row.startsAt)) / 60_000)
          : null;
        const scheduledMinutes = duration !== null && Number.isFinite(duration) && duration > 0
          ? duration
          : null;
        return [
          row.id,
          scheduledMinutes ?? row.estimatedMinutes ?? 1,
        ];
      }));
      const distance = new Map([...ids].map((id) => [id, weights.get(id) ?? 1]));
      const previous = new Map<string, string>();
      let visited = 0;
      while (queue.length > 0) {
        const current = queue.shift()!;
        visited += 1;
        for (const target of outgoing.get(current) ?? []) {
          const candidate = (distance.get(current) ?? 0) + (weights.get(target) ?? 1);
          if (candidate > (distance.get(target) ?? 0)) {
            distance.set(target, candidate);
            previous.set(target, current);
          }
          indegree.set(target, (indegree.get(target) ?? 1) - 1);
          if (indegree.get(target) === 0) queue.push(target);
        }
      }
      if (visited !== ids.size) throw new DependencyCycleError('existing', 'graph');
      let end = [...ids].reduce((best, id) =>
        (distance.get(id) ?? 0) > (distance.get(best) ?? 0) ? id : best,
      );
      const path = [end];
      while (previous.has(end)) {
        end = previous.get(end)!;
        path.push(end);
      }
      return path.reverse();
    },
  };
}
