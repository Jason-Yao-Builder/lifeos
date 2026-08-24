import { z } from 'zod';
import { DateTimeSchema, EntityIdSchema } from './common.js';

export const TASK_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const TASK_IMAGE_MAX_COUNT = 20;
export const TASK_IMAGE_ROUTE_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
const TASK_IMAGE_MAX_BASE64_CHARACTERS = Math.ceil(TASK_IMAGE_MAX_BYTES / 3) * 4;

export const TaskImageMimeTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
export type TaskImageMimeType = z.infer<typeof TaskImageMimeTypeSchema>;

export const TaskImageUploadInputSchema = z
  .object({
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine(
        (value) => ![...value].some((character) => {
          const code = character.charCodeAt(0);
          return code <= 31 || code === 127;
        }),
        'File name contains control characters',
      ),
    mimeType: TaskImageMimeTypeSchema,
    dataBase64: z.string().min(1).max(TASK_IMAGE_MAX_BASE64_CHARACTERS),
  })
  .strict();
export type TaskImageUploadInput = z.infer<typeof TaskImageUploadInputSchema>;

export const TaskImageMetadataSchema = z
  .object({
    id: EntityIdSchema,
    taskId: EntityIdSchema,
    fileName: z.string().min(1).max(255),
    mimeType: TaskImageMimeTypeSchema,
    sizeBytes: z.number().int().positive().max(TASK_IMAGE_MAX_BYTES),
    createdAt: DateTimeSchema,
  })
  .strict();
export type TaskImageMetadata = z.infer<typeof TaskImageMetadataSchema>;

export const TaskImageListResponseSchema = z
  .object({ items: z.array(TaskImageMetadataSchema).max(TASK_IMAGE_MAX_COUNT) })
  .strict();
export type TaskImageListResponse = z.infer<typeof TaskImageListResponseSchema>;
