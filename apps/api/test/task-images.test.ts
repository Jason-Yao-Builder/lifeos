import {
  TASK_IMAGE_MAX_BYTES,
  TASK_IMAGE_ROUTE_BODY_LIMIT_BYTES,
  TaskImageMetadataSchema,
  type TaskImageMimeType,
} from '@lifeos/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTask, createTestHarness, type TestHarness } from './harness.js';

const imageBytes: Record<TaskImageMimeType, Buffer> = {
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0x00]),
  'image/gif': Buffer.from('GIF89a', 'ascii'),
  'image/webp': Buffer.from('RIFF\0\0\0\0WEBP', 'binary'),
};

describe('task image API', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await createTestHarness();
  });

  afterEach(async () => {
    await harness.close();
  });

  const upload = async (
    taskId: string,
    mimeType: TaskImageMimeType,
    data = imageBytes[mimeType],
    fileName = `image.${mimeType.split('/')[1]}`,
  ) => harness.app.inject({
    method: 'POST',
    url: `/api/v1/tasks/${taskId}/images`,
    payload: { fileName, mimeType, dataBase64: data.toString('base64') },
  });

  it('uploads, lists, streams, deletes, and audits image BLOBs', async () => {
    const task = await createTask(harness.app, { title: 'Image lifecycle' });
    const created = await upload(task.id, 'image/png', imageBytes['image/png'], 'diagram.png');

    expect(created.statusCode).toBe(201);
    const metadata = TaskImageMetadataSchema.parse(created.json());
    expect(metadata).toMatchObject({
      taskId: task.id,
      fileName: 'diagram.png',
      mimeType: 'image/png',
      sizeBytes: imageBytes['image/png'].length,
    });

    const listed = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}/images`,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({ items: [metadata] });

    const content = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}/images/${metadata.id}/content`,
    });
    expect(content.statusCode).toBe(200);
    expect(content.headers['content-type']).toBe('image/png');
    expect(content.headers['x-content-type-options']).toBe('nosniff');
    expect(content.rawPayload).toEqual(imageBytes['image/png']);
    expect(harness.database.store.tasks.events('local-workspace', task.id).at(-1)).toMatchObject({
      type: 'task.image.added',
      after: metadata,
    });

    const removed = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/tasks/${task.id}/images/${metadata.id}`,
    });
    expect(removed.statusCode).toBe(204);
    expect(
      (await harness.app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${task.id}/images/${metadata.id}/content`,
      })).statusCode,
    ).toBe(404);
    expect(harness.database.store.tasks.events('local-workspace', task.id).at(-1)).toMatchObject({
      type: 'task.image.deleted',
      before: metadata,
    });

    const history = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}/events`,
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().items.filter((event: { field: string }) => event.field === 'image')).toEqual([
      expect.objectContaining({
        taskId: task.id,
        oldValue: null,
        newValue: 'diagram.png',
        actor: 'user',
        summary: '添加图片「diagram.png」',
      }),
      expect.objectContaining({
        taskId: task.id,
        oldValue: 'diagram.png',
        newValue: null,
        actor: 'user',
        summary: '删除图片「diagram.png」',
      }),
    ]);
  });

  it('accepts only PNG, JPEG, WebP, and GIF with matching file signatures', async () => {
    const task = await createTask(harness.app, { title: 'Allowed formats' });
    for (const mimeType of Object.keys(imageBytes) as TaskImageMimeType[]) {
      const response = await upload(task.id, mimeType);
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json()).toMatchObject({ mimeType });
    }

    for (const payload of [
      { fileName: 'bad.png', mimeType: 'image/png', dataBase64: '%%%not-base64%%%' },
      {
        fileName: 'mismatch.jpg',
        mimeType: 'image/jpeg',
        dataBase64: imageBytes['image/png'].toString('base64'),
      },
      {
        fileName: 'vector.svg',
        mimeType: 'image/svg+xml',
        dataBase64: Buffer.from('<svg/>').toString('base64'),
      },
      {
        fileName: 'unknown.png',
        mimeType: 'image/png',
        dataBase64: Buffer.from('not an image').toString('base64'),
      },
    ]) {
      const response = await harness.app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/images`,
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }
  });

  it('enforces decoded size, route body, and per-task count limits', async () => {
    const task = await createTask(harness.app, { title: 'Image limits' });
    const oversized = Buffer.alloc(TASK_IMAGE_MAX_BYTES + 1);
    imageBytes['image/png'].copy(oversized);
    const tooLarge = await upload(task.id, 'image/png', oversized);
    expect(tooLarge.statusCode).toBe(400);

    const bodyTooLarge = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/images`,
      payload: {
        fileName: 'body.png',
        mimeType: 'image/png',
        dataBase64: 'A'.repeat(TASK_IMAGE_ROUTE_BODY_LIMIT_BYTES),
      },
    });
    expect(bodyTooLarge.statusCode).toBe(413);
    expect(bodyTooLarge.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

    for (let index = 0; index < 20; index += 1) {
      const response = await upload(task.id, 'image/gif', imageBytes['image/gif'], `${index}.gif`);
      expect(response.statusCode, response.body).toBe(201);
    }
    const overflow = await upload(task.id, 'image/gif');
    expect(overflow.statusCode).toBe(400);
    expect(overflow.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('prevents cross-task access and hides images after task soft deletion', async () => {
    const first = await createTask(harness.app, { title: 'First owner task' });
    const second = await createTask(harness.app, { title: 'Second owner task' });
    const metadata = (await upload(first.id, 'image/png')).json();

    expect(
      (await harness.app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${second.id}/images/${metadata.id}/content`,
      })).statusCode,
    ).toBe(404);
    expect(
      (await harness.app.inject({
        method: 'DELETE',
        url: `/api/v1/tasks/${second.id}/images/${metadata.id}`,
      })).statusCode,
    ).toBe(404);

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/api/v1/tasks/${first.id}?version=${first.version}`,
    });
    expect(deleted.statusCode).toBe(204);
    for (const request of [
      { method: 'GET' as const, url: `/api/v1/tasks/${first.id}/images` },
      {
        method: 'GET' as const,
        url: `/api/v1/tasks/${first.id}/images/${metadata.id}/content`,
      },
      {
        method: 'DELETE' as const,
        url: `/api/v1/tasks/${first.id}/images/${metadata.id}`,
      },
    ]) {
      expect((await harness.app.inject(request)).statusCode).toBe(404);
    }
    expect((await upload(first.id, 'image/png')).statusCode).toBe(404);
  });
});
