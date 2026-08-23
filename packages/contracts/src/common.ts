import { z } from 'zod';

export const EntityIdSchema = z.string().trim().min(1).max(128);
export const DateTimeSchema = z.string().datetime({ offset: true });

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const LocalDateSchema = z.string().regex(LOCAL_DATE_PATTERN).refine((value) => {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const candidate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    candidate.getUTCFullYear() === Number(year) &&
    candidate.getUTCMonth() === Number(month) - 1 &&
    candidate.getUTCDate() === Number(day)
  );
}, 'Invalid calendar date');

export type LocalDate = z.infer<typeof LocalDateSchema>;
