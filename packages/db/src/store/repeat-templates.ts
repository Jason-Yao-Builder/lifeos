import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, type SQL } from 'drizzle-orm';
import { InvalidMutationError, NotFoundError } from '../errors.js';
import { encodeJson } from '../json.js';
import { goals, repeatTemplates, tasks } from '../schema.js';
import type {
  ActorInput,
  CreateRepeatTemplateInput,
  RepeatGenerationOptions,
  RepeatGenerationResult,
  RepeatTemplateListFilters,
  RepeatTemplateRecord,
  UpdateRepeatTemplatePatch,
} from '../types.js';
import { DEFAULT_TENANT_ID, DEFAULT_USER_ID } from '../types.js';
import { appendEvent } from './events.js';
import { mapRepeatTemplate } from './mappers.js';
import { atomic, type StoreExecutor, type StoreRuntime } from './runtime.js';
import { createTaskOperations } from './tasks.js';

export interface RepeatTemplateOperations {
  list(filters?: RepeatTemplateListFilters): RepeatTemplateRecord[];
  get(tenantId: string, id: string): RepeatTemplateRecord | null;
  create(input: CreateRepeatTemplateInput, actor?: ActorInput): RepeatTemplateRecord;
  update(
    tenantId: string,
    id: string,
    patch: UpdateRepeatTemplatePatch,
    actor?: ActorInput,
  ): RepeatTemplateRecord;
  softDelete(tenantId: string, id: string, actor?: ActorInput): RepeatTemplateRecord;
  generate(
    tenantId: string,
    id: string,
    options?: RepeatGenerationOptions,
    actor?: ActorInput,
  ): RepeatGenerationResult;
  generateAll(
    tenantId?: string,
    options?: RepeatGenerationOptions,
    actor?: ActorInput,
  ): RepeatGenerationResult[];
}

function parseLocalDate(value: string): Date {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) throw new InvalidMutationError(`Invalid local date: ${value}`);
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new InvalidMutationError(`Invalid local date: ${value}`);
  }
  return date;
}

function formatLocalDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = parseLocalDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatLocalDate(date);
}

function todayInTimezone(now: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  } catch {
    throw new InvalidMutationError(`Invalid timezone: ${timezone}`);
  }
}

function expandCronField(field: string, min: number, max: number, sundayAlias = false): Set<number> {
  const result = new Set<number>();
  for (const segment of field.split(',')) {
    const [base, stepRaw] = segment.split('/');
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step <= 0 || base === undefined) {
      throw new InvalidMutationError(`Invalid cron field: ${field}`);
    }
    const [start, end] = base === '*'
      ? [min, max]
      : base.includes('-')
        ? base.split('-').map(Number)
        : [Number(base), Number(base)];
    if (
      start === undefined ||
      end === undefined ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < min ||
      end > max ||
      start > end
    ) {
      throw new InvalidMutationError(`Invalid cron field: ${field}`);
    }
    for (let value = start; value <= end; value += step) {
      result.add(sundayAlias && value === 7 ? 0 : value);
    }
  }
  return result;
}

interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  anyDayOfMonth: boolean;
  anyDayOfWeek: boolean;
}

function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new InvalidMutationError('Expected a five-field cron expression');
  }
  return {
    minute: expandCronField(fields[0]!, 0, 59),
    hour: expandCronField(fields[1]!, 0, 23),
    dayOfMonth: expandCronField(fields[2]!, 1, 31),
    month: expandCronField(fields[3]!, 1, 12),
    dayOfWeek: expandCronField(fields[4]!, 0, 7, true),
    anyDayOfMonth: fields[2]!.startsWith('*'),
    anyDayOfWeek: fields[4]!.startsWith('*'),
  };
}

function cronMatchesDate(cron: ParsedCron, localDate: string): boolean {
  const date = parseLocalDate(localDate);
  const monthMatches = cron.month.has(date.getUTCMonth() + 1);
  const dayOfMonthMatches = cron.dayOfMonth.has(date.getUTCDate());
  const dayOfWeekMatches = cron.dayOfWeek.has(date.getUTCDay());
  const dayMatches = cron.anyDayOfMonth
    ? dayOfWeekMatches
    : cron.anyDayOfWeek
      ? dayOfMonthMatches
      : dayOfMonthMatches || dayOfWeekMatches;
  return monthMatches && dayMatches;
}

function plannedStartTime(cron: ParsedCron): string | null {
  const minute = Math.min(...cron.minute);
  const hour = Math.min(...cron.hour);
  if (!Number.isFinite(minute) || !Number.isFinite(hour)) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function assertGoal(executor: StoreExecutor, tenantId: string, goalId: string | null): void {
  if (goalId === null) return;
  const row = executor
    .select({ id: goals.id })
    .from(goals)
    .where(and(eq(goals.workspaceId, tenantId), eq(goals.id, goalId), isNull(goals.deletedAt)))
    .get();
  if (!row) throw new NotFoundError('goal', goalId);
}

export function createRepeatTemplateOperations(
  runtime: StoreRuntime,
): RepeatTemplateOperations {
  const get = (tenantId: string, id: string): RepeatTemplateRecord | null => {
    const row = runtime.executor
      .select()
      .from(repeatTemplates)
      .where(
        and(
          eq(repeatTemplates.workspaceId, tenantId),
          eq(repeatTemplates.id, id),
          isNull(repeatTemplates.deletedAt),
        ),
      )
      .get();
    return row ? mapRepeatTemplate(row) : null;
  };

  const list = (filters: RepeatTemplateListFilters = {}): RepeatTemplateRecord[] => {
    const tenantId = filters.tenantId ?? DEFAULT_TENANT_ID;
    const conditions: SQL[] = [
      eq(repeatTemplates.workspaceId, tenantId),
      isNull(repeatTemplates.deletedAt),
    ];
    if (filters.enabled !== undefined) {
      conditions.push(eq(repeatTemplates.enabled, filters.enabled));
    }
    if (filters.goalId) conditions.push(eq(repeatTemplates.goalId, filters.goalId));
    return runtime.executor
      .select()
      .from(repeatTemplates)
      .where(and(...conditions))
      .orderBy(asc(repeatTemplates.createdAt))
      .limit(Math.min(Math.max(filters.limit ?? 100, 1), 500))
      .all()
      .map(mapRepeatTemplate);
  };

  const generate = (
    tenantId: string,
    id: string,
    options: RepeatGenerationOptions = {},
    actor?: ActorInput,
  ): RepeatGenerationResult => atomic(runtime, (tx) => {
    const row = tx
      .select()
      .from(repeatTemplates)
      .where(
        and(
          eq(repeatTemplates.workspaceId, tenantId),
          eq(repeatTemplates.id, id),
          isNull(repeatTemplates.deletedAt),
        ),
      )
      .get();
    if (!row) throw new NotFoundError('repeat_template', id);
    const record = mapRepeatTemplate(row);
    if (!row.enabled) {
      return { templateId: id, dates: [], tasks: [], lastGenerated: row.lastGenerated };
    }
    const cron = parseCron(row.cronExpr);
    const today = todayInTimezone(runtime.now(), row.timezone);
    const start = row.lastGenerated ? addDays(row.lastGenerated, 1) : today;
    const throughDate = options.throughDate ?? addDays(today, row.horizonDays - 1);
    parseLocalDate(throughDate);
    if (start > throughDate) {
      return { templateId: id, dates: [], tasks: [], lastGenerated: row.lastGenerated };
    }
    const dates: string[] = [];
    for (let date = start; date <= throughDate; date = addDays(date, 1)) {
      if (cronMatchesDate(cron, date)) dates.push(date);
    }
    const taskStore = createTaskOperations({ ...runtime, executor: tx, inTransaction: true });
    const generatedTasks = [];
    const generatedDates: string[] = [];
    for (const date of dates) {
      const exists = tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.workspaceId, tenantId),
            eq(tasks.repeatTemplateId, id),
            eq(tasks.plannedDate, date),
            isNull(tasks.deletedAt),
          ),
        )
        .get();
      if (exists) continue;
      generatedTasks.push(taskStore.create({
        tenantId,
        ownerId: row.ownerId,
        title: row.title,
        description: row.description,
        temperature: row.temperature,
        plannedDate: date,
        plannedStartTime: plannedStartTime(cron),
        estimatedMinutes: row.estimatedMinutes,
        goalId: row.goalId,
        repeatTemplateId: row.id,
        tags: record.tags,
      }, actor));
      generatedDates.push(date);
    }
    const updatedRow = tx
      .update(repeatTemplates)
      .set({ lastGenerated: throughDate, updatedAt: runtime.now().toISOString() })
      .where(eq(repeatTemplates.id, id))
      .returning()
      .get();
    appendEvent(tx, {
      tenantId,
      aggregateType: 'repeat_template',
      aggregateId: id,
      type: 'repeat_template.generated',
      actor,
      before: record,
      after: mapRepeatTemplate(updatedRow),
      metadata: { dates: generatedDates, taskIds: generatedTasks.map((task) => task.id) },
    }, runtime.now);
    return {
      templateId: id,
      dates: generatedDates,
      tasks: generatedTasks,
      lastGenerated: throughDate,
    };
  });

  return {
    list,
    get,
    create(input, actor) {
      return atomic(runtime, (tx) => {
        const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
        parseCron(input.cronExpr);
        todayInTimezone(runtime.now(), input.timezone ?? 'Asia/Shanghai');
        if (input.horizonDays !== undefined && (input.horizonDays < 1 || input.horizonDays > 365)) {
          throw new InvalidMutationError('Repeat horizon must be between 1 and 365 days');
        }
        assertGoal(tx, tenantId, input.goalId ?? null);
        const now = runtime.now().toISOString();
        const row = tx
          .insert(repeatTemplates)
          .values({
            id: input.id ?? randomUUID(),
            workspaceId: tenantId,
            ownerId: input.ownerId ?? DEFAULT_USER_ID,
            title: input.title,
            description: input.description ?? null,
            temperature: input.temperature ?? 'warm',
            tagsJson: encodeJson(input.tags ?? [])!,
            estimatedMinutes: input.estimatedMinutes ?? null,
            goalId: input.goalId ?? null,
            cronExpr: input.cronExpr,
            timezone: input.timezone ?? 'Asia/Shanghai',
            horizonDays: input.horizonDays ?? 28,
            enabled: input.enabled ?? true,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        const created = mapRepeatTemplate(row);
        appendEvent(tx, {
          tenantId,
          aggregateType: 'repeat_template',
          aggregateId: row.id,
          type: 'repeat_template.created',
          actor,
          after: created,
        }, runtime.now);
        return created;
      });
    },
    update(tenantId, id, patch, actor) {
      return atomic(runtime, (tx) => {
        const beforeRow = tx
          .select()
          .from(repeatTemplates)
          .where(
            and(
              eq(repeatTemplates.workspaceId, tenantId),
              eq(repeatTemplates.id, id),
              isNull(repeatTemplates.deletedAt),
            ),
          )
          .get();
        if (!beforeRow) throw new NotFoundError('repeat_template', id);
        if (Object.keys(patch).length === 0) {
          throw new InvalidMutationError('Repeat template patch must change at least one field');
        }
        if (patch.cronExpr !== undefined) parseCron(patch.cronExpr);
        if (patch.timezone !== undefined) todayInTimezone(runtime.now(), patch.timezone);
        if (
          patch.horizonDays !== undefined &&
          (patch.horizonDays < 1 || patch.horizonDays > 365)
        ) {
          throw new InvalidMutationError('Repeat horizon must be between 1 and 365 days');
        }
        if (patch.goalId !== undefined) assertGoal(tx, tenantId, patch.goalId);
        const values: Partial<typeof repeatTemplates.$inferInsert> = {
          updatedAt: runtime.now().toISOString(),
        };
        if ('title' in patch) values.title = patch.title;
        if ('description' in patch) values.description = patch.description;
        if ('temperature' in patch) values.temperature = patch.temperature;
        if ('tags' in patch) values.tagsJson = encodeJson(patch.tags)!;
        if ('estimatedMinutes' in patch) values.estimatedMinutes = patch.estimatedMinutes;
        if ('goalId' in patch) values.goalId = patch.goalId;
        if ('cronExpr' in patch) values.cronExpr = patch.cronExpr;
        if ('timezone' in patch) values.timezone = patch.timezone;
        if ('horizonDays' in patch) values.horizonDays = patch.horizonDays;
        if ('enabled' in patch) values.enabled = patch.enabled;
        const row = tx
          .update(repeatTemplates)
          .set(values)
          .where(eq(repeatTemplates.id, id))
          .returning()
          .get();
        const before = mapRepeatTemplate(beforeRow);
        const after = mapRepeatTemplate(row);
        appendEvent(tx, {
          tenantId,
          aggregateType: 'repeat_template',
          aggregateId: id,
          type: 'repeat_template.updated',
          actor,
          before,
          after,
        }, runtime.now);
        return after;
      });
    },
    softDelete(tenantId, id, actor) {
      return atomic(runtime, (tx) => {
        const beforeRow = tx
          .select()
          .from(repeatTemplates)
          .where(
            and(
              eq(repeatTemplates.workspaceId, tenantId),
              eq(repeatTemplates.id, id),
              isNull(repeatTemplates.deletedAt),
            ),
          )
          .get();
        if (!beforeRow) throw new NotFoundError('repeat_template', id);
        const row = tx
          .update(repeatTemplates)
          .set({
            enabled: false,
            deletedAt: runtime.now().toISOString(),
            updatedAt: runtime.now().toISOString(),
          })
          .where(eq(repeatTemplates.id, id))
          .returning()
          .get();
        const before = mapRepeatTemplate(beforeRow);
        const after = mapRepeatTemplate(row);
        appendEvent(tx, {
          tenantId,
          aggregateType: 'repeat_template',
          aggregateId: id,
          type: 'repeat_template.deleted',
          actor,
          before,
          after,
        }, runtime.now);
        return after;
      });
    },
    generate,
    generateAll(tenantId = DEFAULT_TENANT_ID, options, actor) {
      return list({ tenantId, enabled: true, limit: 500 })
        .map((template) => generate(tenantId, template.id, options, actor));
    },
  };
}
