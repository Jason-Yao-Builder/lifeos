import {
  TASK_IMAGE_MAX_BYTES,
  TASK_IMAGE_ROUTE_BODY_LIMIT_BYTES,
  TaskImageListResponseSchema,
  TaskImageMetadataSchema,
  TaskImageUploadInputSchema,
  type TaskImageMimeType,
} from '@lifeos/contracts';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { actorFor, docs, parseWith, ResourceNotFoundError } from '../http.js';
import { TaskImageParamsSchema, TaskImageTaskParamsSchema } from '../schemas.js';
import type { AppDependencies } from '../services.js';

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

function decodeBase64(value: string): Buffer | null {
  if (!BASE64_PATTERN.test(value) || value.length % 4 === 1) return null;
  const firstPadding = value.indexOf('=');
  if (firstPadding !== -1 && firstPadding < value.length - 2) return null;
  if (value.includes('=') && value.length % 4 !== 0) return null;
  const normalized = value + '='.repeat((4 - (value.length % 4)) % 4);
  const data = Buffer.from(normalized, 'base64');
  return data.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '')
    ? data
    : null;
}

function detectMimeType(data: Buffer): TaskImageMimeType | null {
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (data.length >= 6) {
    const signature = data.subarray(0, 6).toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif';
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

const ValidatedTaskImageUploadSchema = TaskImageUploadInputSchema.transform((input, context) => {
  const data = decodeBase64(input.dataBase64);
  if (!data) {
    context.addIssue({
      code: 'custom',
      path: ['dataBase64'],
      message: 'Image data must be valid base64',
    });
    return z.NEVER;
  }
  if (data.length > TASK_IMAGE_MAX_BYTES) {
    context.addIssue({
      code: 'custom',
      path: ['dataBase64'],
      message: 'Image must not exceed 5 MB',
    });
    return z.NEVER;
  }
  const detectedMimeType = detectMimeType(data);
  if (detectedMimeType !== input.mimeType) {
    context.addIssue({
      code: 'custom',
      path: ['mimeType'],
      message: detectedMimeType
        ? `Declared MIME type does not match ${detectedMimeType}`
        : 'Image data has an unsupported file signature',
    });
    return z.NEVER;
  }
  return { fileName: input.fileName, mimeType: input.mimeType, data };
});

export function taskImageRoutes(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId'>>,
) {
  const plugin: FastifyPluginAsync = async (app) => {
    app.get(
      '/tasks/:taskId/images',
      { schema: docs('List task images', ['tasks']) },
      async (request) => {
        const { taskId } = parseWith(TaskImageTaskParamsSchema, request.params);
        const items = await dependencies.store.taskImages.list(dependencies.tenantId, taskId);
        return TaskImageListResponseSchema.parse({ items });
      },
    );

    app.post(
      '/tasks/:taskId/images',
      {
        bodyLimit: TASK_IMAGE_ROUTE_BODY_LIMIT_BYTES,
        schema: docs('Add a task image', ['tasks']),
      },
      async (request, reply) => {
        const { taskId } = parseWith(TaskImageTaskParamsSchema, request.params);
        const input = parseWith(ValidatedTaskImageUploadSchema, request.body);
        const metadata = await dependencies.store.taskImages.create(
          {
            tenantId: dependencies.tenantId,
            taskId,
            fileName: input.fileName,
            mimeType: input.mimeType,
            data: input.data,
          },
          actorFor(request),
        );
        return reply.status(201).send(TaskImageMetadataSchema.parse(metadata));
      },
    );

    app.get(
      '/tasks/:taskId/images/:imageId/content',
      { schema: docs('Get task image content', ['tasks']) },
      async (request, reply) => {
        const { taskId, imageId } = parseWith(TaskImageParamsSchema, request.params);
        const content = await dependencies.store.taskImages.getContent(
          dependencies.tenantId,
          taskId,
          imageId,
        );
        if (!content) throw new ResourceNotFoundError('task image', imageId);
        return reply
          .type(content.metadata.mimeType)
          .header('Content-Length', String(content.metadata.sizeBytes))
          .header('Cache-Control', 'private, no-store')
          .header('X-Content-Type-Options', 'nosniff')
          .send(content.data);
      },
    );

    app.delete(
      '/tasks/:taskId/images/:imageId',
      { schema: docs('Delete a task image', ['tasks']) },
      async (request, reply) => {
        const { taskId, imageId } = parseWith(TaskImageParamsSchema, request.params);
        await dependencies.store.taskImages.remove(
          dependencies.tenantId,
          taskId,
          imageId,
          actorFor(request),
        );
        return reply.status(204).send();
      },
    );
  };
  return plugin;
}
