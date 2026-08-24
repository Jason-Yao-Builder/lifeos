import {
  CreateTaskInputSchema,
  CronExpressionSchema,
  LocalDateSchema,
  RepeatGenerationPlanSchema,
  type CreateTaskInput,
  type LocalDate,
  type RepeatGenerationPlan,
  type RepeatTemplateRecord,
} from '@lifeos/contracts';

interface CronFieldConfig {
  min: number;
  max: number;
  normalize?: (value: number) => number;
}

export interface ParsedCronExpression {
  minutes: readonly number[];
  hours: readonly number[];
  daysOfMonth: readonly number[];
  months: readonly number[];
  daysOfWeek: readonly number[];
  dayOfMonthWildcard: boolean;
  dayOfWeekWildcard: boolean;
}

function parseInteger(value: string, config: CronFieldConfig): number {
  if (!/^\d+$/.test(value)) throw new RangeError(`Invalid cron value: ${value}`);
  const parsed = Number(value);
  if (parsed < config.min || parsed > config.max) {
    throw new RangeError(`Cron value out of range: ${value}`);
  }
  return parsed;
}

function parseField(field: string, config: CronFieldConfig): number[] {
  const values = new Set<number>();
  for (const part of field.split(',')) {
    const segments = part.split('/');
    if (segments.length > 2) throw new RangeError(`Invalid cron field: ${field}`);
    const range = segments[0];
    if (!range) throw new RangeError(`Invalid cron field: ${field}`);
    const step = segments[1] === undefined ? 1 : Number(segments[1]);
    if (!Number.isInteger(step) || step <= 0) throw new RangeError(`Invalid cron step: ${part}`);

    let start: number;
    let end: number;
    if (range === '*') {
      start = config.min;
      end = config.max;
    } else if (range.includes('-')) {
      const bounds = range.split('-');
      if (bounds.length !== 2 || !bounds[0] || !bounds[1]) {
        throw new RangeError(`Invalid cron range: ${range}`);
      }
      start = parseInteger(bounds[0], config);
      end = parseInteger(bounds[1], config);
    } else {
      start = parseInteger(range, config);
      end = segments[1] === undefined ? start : config.max;
    }
    if (start > end) throw new RangeError(`Invalid cron range: ${range}`);
    for (let value = start; value <= end; value += step) {
      values.add(config.normalize?.(value) ?? value);
    }
  }
  return [...values].sort((left, right) => left - right);
}

export function parseCronExpression(expression: string): ParsedCronExpression {
  const valid = CronExpressionSchema.parse(expression);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = valid.split(/\s+/) as [
    string,
    string,
    string,
    string,
    string,
  ];
  return {
    minutes: parseField(minute, { min: 0, max: 59 }),
    hours: parseField(hour, { min: 0, max: 23 }),
    daysOfMonth: parseField(dayOfMonth, { min: 1, max: 31 }),
    months: parseField(month, { min: 1, max: 12 }),
    daysOfWeek: parseField(dayOfWeek, { min: 0, max: 7, normalize: (value) => value % 7 }),
    dayOfMonthWildcard: dayOfMonth === '*',
    dayOfWeekWildcard: dayOfWeek === '*',
  };
}

export function addLocalDateDays(date: LocalDate, days: number): LocalDate {
  const valid = LocalDateSchema.parse(date);
  if (!Number.isInteger(days)) throw new RangeError('days must be an integer');
  const candidate = new Date(`${valid}T00:00:00Z`);
  candidate.setUTCDate(candidate.getUTCDate() + days);
  return LocalDateSchema.parse(candidate.toISOString().slice(0, 10));
}

export function matchesCronDate(expression: string, date: LocalDate): boolean {
  const parsed = parseCronExpression(expression);
  const validDate = LocalDateSchema.parse(date);
  const candidate = new Date(`${validDate}T00:00:00Z`);
  if (!parsed.months.includes(candidate.getUTCMonth() + 1)) return false;
  const matchesDayOfMonth = parsed.daysOfMonth.includes(candidate.getUTCDate());
  const matchesDayOfWeek = parsed.daysOfWeek.includes(candidate.getUTCDay());
  if (parsed.dayOfMonthWildcard) return parsed.dayOfWeekWildcard || matchesDayOfWeek;
  if (parsed.dayOfWeekWildcard) return matchesDayOfMonth;
  return matchesDayOfMonth || matchesDayOfWeek;
}

export type RepeatTemplateForGeneration = Pick<
  RepeatTemplateRecord,
  | 'id'
  | 'title'
  | 'description'
  | 'temperature'
  | 'tags'
  | 'estimatedMinutes'
  | 'goalId'
  | 'cronExpr'
  | 'horizonDays'
  | 'enabled'
  | 'lastGenerated'
>;

export interface RepeatPlanOptions {
  today: LocalDate;
  existingDates?: readonly LocalDate[];
}

export function planRepeatInstances(
  template: RepeatTemplateForGeneration,
  options: RepeatPlanOptions,
): RepeatGenerationPlan {
  const today = LocalDateSchema.parse(options.today);
  if (!Number.isInteger(template.horizonDays) || template.horizonDays < 1 || template.horizonDays > 365) {
    throw new RangeError('horizonDays must be an integer between 1 and 365');
  }
  const currentLastGenerated = template.lastGenerated
    ? LocalDateSchema.parse(template.lastGenerated)
    : null;
  if (!template.enabled) {
    return RepeatGenerationPlanSchema.parse({
      templateId: template.id,
      dates: [],
      lastGenerated: currentLastGenerated,
    });
  }

  const horizonEnd = addLocalDateDays(today, template.horizonDays - 1);
  const firstDate = currentLastGenerated ? addLocalDateDays(currentLastGenerated, 1) : today;
  if (firstDate > horizonEnd) {
    return RepeatGenerationPlanSchema.parse({
      templateId: template.id,
      dates: [],
      lastGenerated: currentLastGenerated,
    });
  }

  const existingDates = new Set(
    (options.existingDates ?? []).map((date) => LocalDateSchema.parse(date)),
  );
  const dates: LocalDate[] = [];
  for (let date = firstDate; date <= horizonEnd; date = addLocalDateDays(date, 1)) {
    if (!existingDates.has(date) && matchesCronDate(template.cronExpr, date)) dates.push(date);
  }
  return RepeatGenerationPlanSchema.parse({
    templateId: template.id,
    dates,
    lastGenerated: horizonEnd,
  });
}

export function materializeRepeatTask(
  template: RepeatTemplateForGeneration,
  plannedDate: LocalDate,
): CreateTaskInput {
  return CreateTaskInputSchema.parse({
    title: template.title,
    description: template.description,
    temperature: template.temperature,
    tags: [...template.tags],
    estimatedMinutes: template.estimatedMinutes,
    goalId: template.goalId,
    repeatTemplateId: template.id,
    plannedDate,
  });
}
