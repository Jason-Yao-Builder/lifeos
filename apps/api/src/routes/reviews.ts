import {
  CarryoverBatchSchema,
  CarryoverDecisionSchema,
  EntityIdSchema,
  LocalDateSchema,
  ReviewCardRecordSchema,
  ReviewTypeSchema,
} from '@lifeos/contracts';
import type { TaskRecord } from '@lifeos/contracts';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorFor, docs, parseWith, projectTask, ResourceNotFoundError } from '../http.js';
import { DayParamsSchema } from '../schemas.js';
import type { AppDependencies, EventRecord, StoreTaskPatch } from '../services.js';

const ReviewListQuerySchema = z
  .object({
    type: ReviewTypeSchema.optional(),
    period: LocalDateSchema.optional(),
    periodStart: LocalDateSchema.optional(),
    periodEnd: LocalDateSchema.optional(),
  })
  .strict();
const DailyPlanBodySchema = z
  .object({
    date: LocalDateSchema,
    plannedTaskIds: z.array(EntityIdSchema).max(500).optional(),
    carryoverDecisions: z.array(CarryoverDecisionSchema).max(500).default([]),
  })
  .strict();
const DailyReviewBodySchema = z
  .object({
    date: LocalDateSchema,
    incompleteReasons: z
      .array(z.object({ taskId: EntityIdSchema, reason: z.string().trim().min(1).max(1_000) }).strict())
      .max(500)
      .default([]),
    totalFocusMinutes: z.number().int().nonnegative().optional(),
  })
  .strict();
const PeriodReviewBodySchema = z.object({ date: LocalDateSchema.optional() }).strict();

export function reviewRoutes(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId' | 'userId' | 'now'>>,
  timeZone: string,
) {
  const plugin: FastifyPluginAsync = async (app) => {
    app.get('/reviews', { schema: docs('List review cards', ['reviews']) }, async (request) => {
      const query = parseWith(ReviewListQuerySchema, request.query);
      return {
        items: dependencies.store.reviews
          .list({
            tenantId: dependencies.tenantId,
            ...(query.type ? { type: query.type } : {}),
            ...(query.period ? { periodFrom: query.period, periodTo: query.period } : {}),
            ...(query.periodStart ? { periodFrom: query.periodStart } : {}),
            ...(query.periodEnd ? { periodTo: query.periodEnd } : {}),
          })
          .map((review) => ReviewCardRecordSchema.parse(review)),
      };
    });

    app.get('/days/:date/morning', { schema: docs('Get morning planning data', ['reviews']) }, async (request) => {
      const { date } = parseWith(DayParamsSchema, request.params);
      const yesterday = shiftDate(date, -1);
      const tasks = dependencies.store.tasks.list({ tenantId: dependencies.tenantId, limit: 500 });
      const unfinished = tasks.filter(
        (task) => task.plannedDate === yesterday && ['todo', 'in_progress'].includes(task.status),
      );
      const planned = tasks.filter(
        (task) => task.plannedDate === date && !['archived', 'abandoned'].includes(task.status),
      );
      const deadlineToday = tasks.filter(
        (task) => task.deadline && localDate(task.deadline, timeZone) === date,
      );
      const map = (task: TaskRecord) =>
        projectTask(
          task,
          dependencies.store.dependencies.isBlocked(dependencies.tenantId, task.id),
        );
      return { unfinished: unfinished.map(map), planned: planned.map(map), deadlineToday: deadlineToday.map(map) };
    });

    app.post('/days/:date/carryover', { schema: docs('Apply carry-over decisions', ['reviews']) }, async (request) => {
      const { date } = parseWith(DayParamsSchema, request.params);
      const body = parseWith(CarryoverBatchSchema, request.body);
      const items = dependencies.store.transaction((store) =>
        body.decisions.map((decision) => {
          const task = store.tasks.get(dependencies.tenantId, decision.taskId);
          if (!task) throw new ResourceNotFoundError('task', decision.taskId);
          const patch = carryoverPatch(task, decision, date);
          return store.tasks.update(
            dependencies.tenantId,
            task.id,
            task.version,
            patch,
            actorFor(request),
          );
        }),
      );
      return { items: items.map((task) => projectTask(task, false)) };
    });

    app.post('/reviews/daily-plan', { schema: docs('Create a daily plan review', ['reviews']) }, async (request) => {
      const body = parseWith(DailyPlanBodySchema, request.body);
      return upsertDailyPlan(dependencies, body, request);
    });

    app.post('/reviews/daily-review', { schema: docs('Create a daily review', ['reviews']) }, async (request) => {
      const body = parseWith(DailyReviewBodySchema, request.body);
      return upsertDailyReview(dependencies, body, timeZone, request);
    });

    app.post('/reviews/weekly', { schema: docs('Create a weekly review', ['reviews']) }, async (request) => {
      const { date = localDate(dependencies.now().toISOString(), timeZone) } = parseWith(PeriodReviewBodySchema, request.body ?? {});
      return upsertWeeklyReview(dependencies, date, timeZone, request);
    });

    app.post('/reviews/monthly', { schema: docs('Create a monthly review', ['reviews']) }, async (request) => {
      const { date = localDate(dependencies.now().toISOString(), timeZone) } = parseWith(PeriodReviewBodySchema, request.body ?? {});
      return upsertMonthlyReview(dependencies, date, timeZone, request);
    });
  };
  return plugin;
}

function upsertDailyPlan(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId' | 'userId'>>,
  body: z.infer<typeof DailyPlanBodySchema>,
  request: FastifyRequest,
) {
  const all = dependencies.store.tasks.list({ tenantId: dependencies.tenantId, limit: 500 });
  const requested = body.plannedTaskIds
    ? new Set(body.plannedTaskIds)
    : new Set(all.filter((task) => task.plannedDate === body.date).map((task) => task.id));
  const planned = all.filter((task) => requested.has(task.id));
  if (planned.length !== requested.size) throw new ResourceNotFoundError('task', 'plannedTaskIds');
  const content = {
    plannedTasks: planned.map((task) => ({ taskId: task.id, title: task.title })),
    carryoverDecisions: body.carryoverDecisions,
  };
  return upsertReview(
    dependencies,
    { type: 'daily_plan', periodStart: body.date, periodEnd: body.date, content },
    request,
  );
}

function upsertDailyReview(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId' | 'userId'>>,
  body: z.infer<typeof DailyReviewBodySchema>,
  timeZone: string,
  request: FastifyRequest,
) {
  const tasks = dependencies.store.tasks.list({ tenantId: dependencies.tenantId, limit: 500 });
  const plan = dependencies.store.reviews.list({
    tenantId: dependencies.tenantId,
    type: 'daily_plan',
    periodFrom: body.date,
    periodTo: body.date,
  })[0];
  const plannedSeed = asRecord(plan?.content).plannedTasks;
  const plannedIds = new Set(
    Array.isArray(plannedSeed)
      ? plannedSeed.flatMap((item) => {
          const id = asRecord(item).taskId;
          return typeof id === 'string' ? [id] : [];
        })
      : tasks.filter((task) => task.plannedDate === body.date).map((task) => task.id),
  );
  const plannedTasks = tasks
    .filter((task) => plannedIds.has(task.id))
    .map((task) => ({ taskId: task.id, title: task.title, completed: wasCompleted(task) }));
  const completed = plannedTasks.filter((task) => task.completed).length;
  const unplannedCompleted = tasks
    .filter(
      (task) =>
        !plannedIds.has(task.id) &&
        wasCompleted(task) &&
        task.completedAt !== null &&
        localDate(task.completedAt, timeZone) === body.date,
    )
    .map((task) => ({ taskId: task.id, title: task.title }));
  const content = {
    plannedTasks,
    unplannedCompleted,
    completionRate: plannedTasks.length === 0 ? 0 : Math.round((completed / plannedTasks.length) * 100),
    incompleteReasons: body.incompleteReasons.filter((reason) =>
      plannedTasks.some((task) => task.taskId === reason.taskId && !task.completed),
    ),
    totalFocusMinutes:
      body.totalFocusMinutes ??
      tasks
        .filter(
          (task) =>
            wasCompleted(task) &&
            task.completedAt !== null &&
            localDate(task.completedAt, timeZone) === body.date,
        )
        .reduce((sum, task) => sum + task.actualMinutes, 0),
  };
  return upsertReview(
    dependencies,
    { type: 'daily_review', periodStart: body.date, periodEnd: body.date, content },
    request,
  );
}

function upsertWeeklyReview(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId' | 'userId'>>,
  date: string,
  timeZone: string,
  request: FastifyRequest,
) {
  const [periodStart, periodEnd] = weekBounds(date);
  const daily = dependencies.store.reviews.list({
    tenantId: dependencies.tenantId,
    type: 'daily_review',
    periodFrom: periodStart,
    periodTo: periodEnd,
  });
  const tasks = dependencies.store.tasks.list({ tenantId: dependencies.tenantId, limit: 500 });
  const events = taskEvents(dependencies, tasks);
  let plannedCount = 0;
  let completedCount = 0;
  for (const review of daily) {
    const planned = asRecord(review.content).plannedTasks;
    if (!Array.isArray(planned)) continue;
    plannedCount += planned.length;
    completedCount += planned.filter((item) => asRecord(item).completed === true).length;
  }
  const goals = dependencies.store.goals.list({ tenantId: dependencies.tenantId }).map((goal) => ({
    goalId: goal.id,
    completedTaskIds: tasks
      .filter(
        (task) =>
          task.goalId === goal.id &&
          task.completedAt !== null &&
          localDate(task.completedAt, timeZone) >= periodStart &&
          localDate(task.completedAt, timeZone) <= periodEnd,
      )
      .map((task) => task.id),
  }));
  const dailyCompleted = datesBetween(periodStart, periodEnd).map((itemDate) => ({
    date: itemDate,
    count: tasks.filter(
      (task) => task.completedAt && localDate(task.completedAt, timeZone) === itemDate,
    ).length,
  }));
  const dailyCompletionRates = datesBetween(periodStart, periodEnd).map((itemDate) => {
    const review = daily.find((item) => item.periodStart === itemDate);
    const rate = asRecord(review?.content).completionRate;
    return { date: itemDate, rate: typeof rate === 'number' ? rate : 0 };
  });
  const content = {
    plannedCount,
    completedCount,
    completionRate: plannedCount === 0 ? 0 : Math.round((completedCount / plannedCount) * 100),
    temperatureChanges: summarizeTemperatureChanges(events, periodStart, periodEnd, timeZone),
    goals,
    carriedTaskIds: tasks
      .filter((task) => task.carryOverFrom && task.carryOverFrom >= periodStart && task.carryOverFrom <= periodEnd)
      .map((task) => task.id),
    dailyCompleted,
    dailyCompletionRates,
  };
  return upsertReview(
    dependencies,
    { type: 'weekly_review', periodStart, periodEnd, content },
    request,
  );
}

function upsertMonthlyReview(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId' | 'userId'>>,
  date: string,
  timeZone: string,
  request: FastifyRequest,
) {
  const periodStart = `${date.slice(0, 7)}-01`;
  const periodEnd = shiftDate(shiftMonth(periodStart, 1), -1);
  const tasks = dependencies.store.tasks.list({ tenantId: dependencies.tenantId, limit: 500 });
  const events = taskEvents(dependencies, tasks);
  const inPeriod = (value: string | null) =>
    value !== null && localDate(value, timeZone) >= periodStart && localDate(value, timeZone) <= periodEnd;
  const goals = dependencies.store.goals.list({
    tenantId: dependencies.tenantId,
    status: 'active',
  }).map((goal) => {
    const related = tasks.filter((task) => task.goalId === goal.id);
    const completed = related.filter(wasCompleted).length;
    const monthCompleted = related.filter((task) => inPeriod(task.completedAt)).length;
    return {
      goalId: goal.id,
      title: goal.title,
      monthCompleted,
      completed,
      total: related.length,
      percent: related.length === 0 ? 0 : Math.round((completed / related.length) * 100),
    };
  });
  const repeated = tasks.filter(
    (task) =>
      task.repeatTemplateId !== null &&
      task.plannedDate !== null &&
      task.plannedDate >= periodStart &&
      task.plannedDate <= periodEnd,
  );
  const repeatedCompleted = repeated.filter(
    (task) => task.completedAt !== null && inPeriod(task.completedAt),
  ).length;
  const content = {
    goals,
    taskCounts: {
      created: tasks.filter((task) => inPeriod(task.createdAt)).length,
      completed: tasks.filter((task) => inPeriod(task.completedAt)).length,
      abandoned: tasks.filter((task) => task.status === 'abandoned' && inPeriod(task.updatedAt)).length,
    },
    temperatureTrend: buildTemperatureTrend(events, periodStart, periodEnd, timeZone),
    repeatCompletionRate:
      repeated.length === 0
        ? 0
        : Math.round((repeatedCompleted / repeated.length) * 100),
    frequentCarryovers: summarizeCarryovers(events, tasks, periodStart, periodEnd),
  };
  return upsertReview(
    dependencies,
    { type: 'monthly_review', periodStart, periodEnd, content },
    request,
  );
}

function upsertReview(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId' | 'userId'>>,
  input: {
    type: 'daily_plan' | 'daily_review' | 'weekly_review' | 'monthly_review';
    periodStart: string;
    periodEnd: string;
    content: unknown;
  },
  request: FastifyRequest,
) {
  const existing = dependencies.store.reviews.list({
    tenantId: dependencies.tenantId,
    type: input.type,
    periodFrom: input.periodStart,
    periodTo: input.periodEnd,
  })[0];
  if (existing) {
    return ReviewCardRecordSchema.parse(
      dependencies.store.reviews.update(
        dependencies.tenantId,
        existing.id,
        input.content,
        actorFor(request),
      ),
    );
  }
  return ReviewCardRecordSchema.parse(
    dependencies.store.reviews.create(
      {
        tenantId: dependencies.tenantId,
        ownerId: dependencies.userId,
        ...input,
      },
      actorFor(request),
    ),
  );
}

function carryoverPatch(
  task: TaskRecord,
  decision: z.infer<typeof CarryoverDecisionSchema>,
  date: string,
): StoreTaskPatch {
  const carryOverFrom = task.plannedDate ?? shiftDate(date, -1);
  if (decision.action === 'carry_today') {
    return { plannedDate: date, carryOverFrom };
  }
  if (decision.action === 'reschedule') {
    return { plannedDate: decision.targetDate, carryOverFrom };
  }
  if (decision.action === 'cool_down') {
    return { temperature: cooler(task.temperature), plannedDate: null, carryOverFrom };
  }
  return { status: 'abandoned', carryOverFrom };
}

function cooler(temperature: TaskRecord['temperature']): TaskRecord['temperature'] {
  if (temperature === 'hot') return 'warm';
  if (temperature === 'warm') return 'cold';
  if (temperature === 'cold') return 'inspiration';
  return 'inspiration';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function taskEvents(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId'>>,
  tasks: TaskRecord[],
): EventRecord[] {
  return tasks.flatMap((task) =>
    dependencies.store.tasks.events(dependencies.tenantId, task.id),
  );
}

const temperatureRank: Record<TaskRecord['temperature'], number> = {
  inspiration: 0,
  cold: 1,
  warm: 2,
  hot: 3,
};

function isTemperature(value: unknown): value is TaskRecord['temperature'] {
  return typeof value === 'string' && value in temperatureRank;
}

function summarizeTemperatureChanges(
  events: EventRecord[],
  periodStart: string,
  periodEnd: string,
  timeZone: string,
) {
  const heated = new Set<string>();
  const cooled = new Set<string>();
  for (const event of events) {
    if (event.type !== 'task.updated') continue;
    const eventDate = localDate(event.createdAt, timeZone);
    if (eventDate < periodStart || eventDate > periodEnd) continue;
    const before = asRecord(event.before).temperature;
    const after = asRecord(event.after).temperature;
    if (!isTemperature(before) || !isTemperature(after) || before === after) continue;
    if (temperatureRank[after] > temperatureRank[before]) heated.add(event.aggregateId);
    else cooled.add(event.aggregateId);
  }
  return { heatedTaskIds: [...heated], cooledTaskIds: [...cooled] };
}

function buildTemperatureTrend(
  events: EventRecord[],
  periodStart: string,
  periodEnd: string,
  timeZone: string,
) {
  return monthWeekRanges(periodStart, periodEnd).map(([weekStart, weekEnd]) => {
    const snapshots = new Map<string, Record<string, unknown>>();
    for (const event of events) {
      if (localDate(event.createdAt, timeZone) > weekEnd) continue;
      const after = asRecord(event.after);
      if (isTemperature(after.temperature)) snapshots.set(event.aggregateId, after);
    }
    const byTemperature = { inspiration: 0, cold: 0, warm: 0, hot: 0 };
    for (const snapshot of snapshots.values()) {
      if (snapshot.deletedAt !== null && snapshot.deletedAt !== undefined) continue;
      if (isTemperature(snapshot.temperature)) byTemperature[snapshot.temperature] += 1;
    }
    return { periodStart: weekStart, periodEnd: weekEnd, byTemperature };
  });
}

function monthWeekRanges(start: string, end: string): Array<[string, string]> {
  const ranges: Array<[string, string]> = [];
  for (let cursor = start; cursor <= end;) {
    const weekEnd = weekBounds(cursor)[1] < end ? weekBounds(cursor)[1] : end;
    ranges.push([cursor, weekEnd]);
    cursor = shiftDate(weekEnd, 1);
  }
  return ranges;
}

function summarizeCarryovers(
  events: EventRecord[],
  tasks: TaskRecord[],
  periodStart: string,
  periodEnd: string,
) {
  const counts = new Map<string, number>();
  const titles = new Map(tasks.map((task) => [task.id, task.title]));
  for (const event of events) {
    if (event.type !== 'task.updated') continue;
    const before = asRecord(event.before);
    const after = asRecord(event.after);
    const carryOverFrom = after.carryOverFrom;
    if (
      typeof carryOverFrom !== 'string' ||
      carryOverFrom < periodStart ||
      carryOverFrom > periodEnd ||
      carryOverFrom === before.carryOverFrom
    ) {
      continue;
    }
    counts.set(event.aggregateId, (counts.get(event.aggregateId) ?? 0) + 1);
    if (typeof after.title === 'string') titles.set(event.aggregateId, after.title);
  }
  return [...counts]
    .map(([taskId, count]) => ({ taskId, title: titles.get(taskId) ?? taskId, count }))
    .sort((left, right) => right.count - left.count || left.taskId.localeCompare(right.taskId))
    .slice(0, 5);
}

function wasCompleted(task: TaskRecord): boolean {
  return task.status === 'completed' || task.completedAt !== null;
}

function localDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function shiftMonth(date: string, months: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
}

function weekBounds(date: string): [string, string] {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const monday = shiftDate(date, day === 0 ? -6 : 1 - day);
  return [monday, shiftDate(monday, 6)];
}

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let current = start; current <= end; current = shiftDate(current, 1)) dates.push(current);
  return dates;
}
