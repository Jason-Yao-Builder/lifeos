import { TaskImageMetadataSchema } from '@lifeos/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createDatabase,
  DEFAULT_TENANT_ID,
  InvalidMutationError,
  NotFoundError,
  type LifeOSDatabase,
} from '../src/index.js';

const fixedNow = new Date('2026-08-24T08:00:00.000Z');
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('task image store', () => {
  let database: LifeOSDatabase;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:', now: () => fixedNow });
  });

  afterEach(() => {
    database.close();
  });

  it('stores BLOB content separately from metadata and audits add/delete atomically', () => {
    const task = database.store.tasks.create({ title: 'Document with image' });
    const metadata = database.store.taskImages.create(
      {
        taskId: task.id,
        fileName: 'diagram.png',
        mimeType: 'image/png',
        data: pngBytes,
      },
      { type: 'human', id: 'local-user' },
    );

    expect(TaskImageMetadataSchema.parse(metadata)).toEqual(metadata);
    expect(metadata).toMatchObject({
      taskId: task.id,
      fileName: 'diagram.png',
      mimeType: 'image/png',
      sizeBytes: pngBytes.length,
      createdAt: fixedNow.toISOString(),
    });
    expect(database.store.taskImages.list(DEFAULT_TENANT_ID, task.id)).toEqual([metadata]);
    expect(database.store.taskImages.getContent(DEFAULT_TENANT_ID, task.id, metadata.id)).toEqual({
      metadata,
      data: pngBytes,
    });
    expect(
      database.sqlite
        .prepare('SELECT typeof(data) AS type, length(data) AS size FROM task_images WHERE id = ?')
        .get(metadata.id),
    ).toEqual({ type: 'blob', size: pngBytes.length });
    expect(database.store.tasks.events(DEFAULT_TENANT_ID, task.id).at(-1)).toMatchObject({
      type: 'task.image.added',
      after: metadata,
    });

    expect(
      database.store.taskImages.remove(DEFAULT_TENANT_ID, task.id, metadata.id, {
        type: 'human',
      }),
    ).toEqual(metadata);
    expect(database.store.taskImages.list(DEFAULT_TENANT_ID, task.id)).toEqual([]);
    expect(database.store.tasks.events(DEFAULT_TENANT_ID, task.id).at(-1)).toMatchObject({
      type: 'task.image.deleted',
      before: metadata,
    });
  });

  it('binds every image lookup to its active task and workspace', () => {
    const first = database.store.tasks.create({ title: 'First task' });
    const second = database.store.tasks.create({ title: 'Second task' });
    const image = database.store.taskImages.create({
      taskId: first.id,
      fileName: 'bound.png',
      mimeType: 'image/png',
      data: pngBytes,
    });

    expect(database.store.taskImages.getContent(DEFAULT_TENANT_ID, second.id, image.id)).toBeNull();
    expect(() =>
      database.store.taskImages.remove(DEFAULT_TENANT_ID, second.id, image.id),
    ).toThrow(NotFoundError);
    expect(() => database.store.taskImages.list('other-workspace', first.id)).toThrow(
      NotFoundError,
    );

    database.store.tasks.softDelete(DEFAULT_TENANT_ID, first.id, first.version);
    expect(() => database.store.taskImages.list(DEFAULT_TENANT_ID, first.id)).toThrow(
      NotFoundError,
    );
    expect(() =>
      database.store.taskImages.getContent(DEFAULT_TENANT_ID, first.id, image.id),
    ).toThrow(NotFoundError);
    expect(() =>
      database.store.taskImages.remove(DEFAULT_TENANT_ID, first.id, image.id),
    ).toThrow(NotFoundError);
  });

  it('enforces the per-task image cap inside the store transaction', () => {
    const task = database.store.tasks.create({ title: 'Image cap' });
    for (let index = 0; index < 20; index += 1) {
      database.store.taskImages.create({
        id: `image-${index}`,
        taskId: task.id,
        fileName: `${index}.png`,
        mimeType: 'image/png',
        data: pngBytes,
      });
    }
    expect(database.store.taskImages.list(DEFAULT_TENANT_ID, task.id)).toHaveLength(20);
    expect(() =>
      database.store.taskImages.create({
        taskId: task.id,
        fileName: 'overflow.png',
        mimeType: 'image/png',
        data: pngBytes,
      }),
    ).toThrow(InvalidMutationError);
  });
});
