import { z } from 'zod';

export const ApiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'AI_UNAVAILABLE',
  'INTERNAL_ERROR',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorDetailSchema = z
  .object({
    path: z.string(),
    message: z.string(),
    code: z.string().optional(),
  })
  .strict();

export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: ApiErrorCodeSchema,
        message: z.string().min(1),
        details: z.array(ApiErrorDetailSchema).optional(),
        correlationId: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict();
export const ApiErrorBodySchema = ApiErrorSchema;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiErrorBody = ApiError;
