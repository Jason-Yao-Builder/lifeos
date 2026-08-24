import { describe, expect, it } from 'vitest';
import {
  TaskImageListResponseSchema,
  TaskImageMetadataSchema,
  TaskImageUploadInputSchema,
} from './index.js';

describe('task image contracts', () => {
  it('accepts the frozen upload and metadata shapes', () => {
    expect(
      TaskImageUploadInputSchema.parse({
        fileName: ' photo.png ',
        mimeType: 'image/png',
        dataBase64: 'iVBORw0KGgo=',
      }),
    ).toEqual({
      fileName: 'photo.png',
      mimeType: 'image/png',
      dataBase64: 'iVBORw0KGgo=',
    });

    const metadata = TaskImageMetadataSchema.parse({
      id: 'image-1',
      taskId: 'task-1',
      fileName: 'photo.png',
      mimeType: 'image/png',
      sizeBytes: 8,
      createdAt: '2026-08-24T08:00:00.000Z',
    });
    expect(TaskImageListResponseSchema.parse({ items: [metadata] })).toEqual({
      items: [metadata],
    });
  });

  it('rejects SVG, unknown fields, and oversized metadata', () => {
    expect(
      TaskImageUploadInputSchema.safeParse({
        fileName: 'vector.svg',
        mimeType: 'image/svg+xml',
        dataBase64: 'PHN2Zz4=',
      }).success,
    ).toBe(false);
    expect(
      TaskImageUploadInputSchema.safeParse({
        fileName: 'photo.png',
        mimeType: 'image/png',
        dataBase64: 'iVBORw0KGgo=',
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      TaskImageMetadataSchema.safeParse({
        id: 'image-1',
        taskId: 'task-1',
        fileName: 'photo.png',
        mimeType: 'image/png',
        sizeBytes: 5 * 1024 * 1024 + 1,
        createdAt: '2026-08-24T08:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
