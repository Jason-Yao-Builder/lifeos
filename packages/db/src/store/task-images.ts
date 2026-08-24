import { randomUUID } from 'node:crypto';
import {
  TASK_IMAGE_MAX_BYTES,
  TASK_IMAGE_MAX_COUNT,
  type TaskImageMetadata,
} from '@lifeos/contracts';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { InvalidMutationError, NotFoundError } from '../errors.js';
import { taskImageMimeTypes, taskImages, tasks } from '../schema.js';
import type {
  ActorInput,
  CreateTaskImageInput,
  TaskImageContentRecord,
} from '../types.js';
import { DEFAULT_TENANT_ID } from '../types.js';
import { appendEvent } from './events.js';
import { atomic, type StoreExecutor, type StoreRuntime } from './runtime.js';

type TaskImageMetadataRow = Pick<
  typeof taskImages.$inferSelect,
  'id' | 'taskId' | 'fileName' | 'mimeType' | 'sizeBytes' | 'createdAt'
>;

const metadataColumns = {
  id: taskImages.id,
  taskId: taskImages.taskId,
  fileName: taskImages.fileName,
  mimeType: taskImages.mimeType,
  sizeBytes: taskImages.sizeBytes,
  createdAt: taskImages.createdAt,
};

const mapMetadata = (row: TaskImageMetadataRow): TaskImageMetadata => ({
  id: row.id,
  taskId: row.taskId,
  fileName: row.fileName,
  mimeType: row.mimeType,
  sizeBytes: row.sizeBytes,
  createdAt: row.createdAt,
});

function assertActiveTask(executor: StoreExecutor, tenantId: string, taskId: string): void {
  const task = executor
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, tenantId),
        eq(tasks.id, taskId),
        isNull(tasks.deletedAt),
      ),
    )
    .get();
  if (!task) throw new NotFoundError('task', taskId);
}

function assertValidInput(input: CreateTaskImageInput): void {
  const fileName = input.fileName.trim();
  const hasControlCharacter = [...fileName].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (
    fileName.length === 0 ||
    fileName.length > 255 ||
    hasControlCharacter
  ) {
    throw new InvalidMutationError('Invalid task image file name');
  }
  if (!taskImageMimeTypes.some((mimeType) => mimeType === input.mimeType)) {
    throw new InvalidMutationError('Unsupported task image MIME type');
  }
  if (!Buffer.isBuffer(input.data) || input.data.length === 0) {
    throw new InvalidMutationError('Task image data must not be empty');
  }
  if (input.data.length > TASK_IMAGE_MAX_BYTES) {
    throw new InvalidMutationError('Task image exceeds 5 MB');
  }
}

export interface TaskImageOperations {
  list(tenantId: string, taskId: string): TaskImageMetadata[];
  getContent(
    tenantId: string,
    taskId: string,
    imageId: string,
  ): TaskImageContentRecord | null;
  create(input: CreateTaskImageInput, actor?: ActorInput): TaskImageMetadata;
  remove(
    tenantId: string,
    taskId: string,
    imageId: string,
    actor?: ActorInput,
  ): TaskImageMetadata;
}

export function createTaskImageOperations(runtime: StoreRuntime): TaskImageOperations {
  return {
    list(tenantId, taskId) {
      assertActiveTask(runtime.executor, tenantId, taskId);
      return runtime.executor
        .select(metadataColumns)
        .from(taskImages)
        .where(
          and(
            eq(taskImages.workspaceId, tenantId),
            eq(taskImages.taskId, taskId),
          ),
        )
        .orderBy(asc(taskImages.createdAt), asc(taskImages.id))
        .all()
        .map(mapMetadata);
    },
    getContent(tenantId, taskId, imageId) {
      assertActiveTask(runtime.executor, tenantId, taskId);
      const row = runtime.executor
        .select()
        .from(taskImages)
        .where(
          and(
            eq(taskImages.workspaceId, tenantId),
            eq(taskImages.taskId, taskId),
            eq(taskImages.id, imageId),
          ),
        )
        .get();
      return row ? { metadata: mapMetadata(row), data: Buffer.from(row.data) } : null;
    },
    create(input, actor) {
      assertValidInput(input);
      return atomic(runtime, (tx) => {
        const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
        assertActiveTask(tx, tenantId, input.taskId);
        const imageCount = tx
          .select({ value: count() })
          .from(taskImages)
          .where(
            and(
              eq(taskImages.workspaceId, tenantId),
              eq(taskImages.taskId, input.taskId),
            ),
          )
          .get()?.value ?? 0;
        if (imageCount >= TASK_IMAGE_MAX_COUNT) {
          throw new InvalidMutationError('Task image limit reached');
        }
        const row = tx
          .insert(taskImages)
          .values({
            id: input.id ?? randomUUID(),
            workspaceId: tenantId,
            taskId: input.taskId,
            fileName: input.fileName.trim(),
            mimeType: input.mimeType,
            sizeBytes: input.data.length,
            data: Buffer.from(input.data),
            createdAt: runtime.now().toISOString(),
          })
          .returning()
          .get();
        const metadata = mapMetadata(row);
        appendEvent(
          tx,
          {
            tenantId,
            aggregateType: 'task',
            aggregateId: input.taskId,
            type: 'task.image.added',
            actor,
            after: metadata,
          },
          runtime.now,
        );
        return metadata;
      });
    },
    remove(tenantId, taskId, imageId, actor) {
      return atomic(runtime, (tx) => {
        assertActiveTask(tx, tenantId, taskId);
        const row = tx
          .select()
          .from(taskImages)
          .where(
            and(
              eq(taskImages.workspaceId, tenantId),
              eq(taskImages.taskId, taskId),
              eq(taskImages.id, imageId),
            ),
          )
          .get();
        if (!row) throw new NotFoundError('task_image', imageId);
        tx.delete(taskImages)
          .where(
            and(
              eq(taskImages.workspaceId, tenantId),
              eq(taskImages.taskId, taskId),
              eq(taskImages.id, imageId),
            ),
          )
          .run();
        const metadata = mapMetadata(row);
        appendEvent(
          tx,
          {
            tenantId,
            aggregateType: 'task',
            aggregateId: taskId,
            type: 'task.image.deleted',
            actor,
            before: metadata,
          },
          runtime.now,
        );
        return metadata;
      });
    },
  };
}
