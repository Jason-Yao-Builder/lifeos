import { randomUUID } from 'node:crypto';
import {
  compileAdaptivePlan,
  compileTaskBreakdown,
  evaluateDurationMemory,
  type PlanDependency,
} from '@lifeos/ai';
import { dateTimeToLocalDate } from '@lifeos/domain';
import type { FastifyPluginAsync } from 'fastify';
import {
  ResourceNotFoundError,
  actorFor,
  docs,
  parseWith,
  projectTask,
  taskWasManuallyScored,
  tasksForAiContext,
} from '../http.js';
import {
  AdaptivePlanBodySchema,
  AiDailySummarySchema,
  AiTaskScoresSchema,
  DailySummaryBodySchema,
  ScoreTasksBodySchema,
  TaskBreakdownBodySchema,
} from '../schemas.js';
import type { AppDependencies } from '../services.js';

function aiUnavailable(error: unknown): Error & { code: string } {
  const wrapped = new Error(error instanceof Error ? error.message : 'AI operation failed') as Error & {
    code: string;
  };
  wrapped.code = 'AI_UNAVAILABLE';
  return wrapped;
}

export function aiRoutes(
  dependencies: Required<Pick<AppDependencies, 'store' | 'ai' | 'tenantId' | 'now'>>,
  timeZone: string,
) {
  const plugin: FastifyPluginAsync = async (app) => {
    app.post('/ai/score-tasks', { schema: docs('Score tasks', ['ai']) }, async (request) => {
      const { taskIds } = parseWith(ScoreTasksBodySchema, request.body ?? {});
      const tasks = taskIds
        ? await Promise.all(
            taskIds.map(async (id) => {
              const task = await dependencies.store.tasks.get(dependencies.tenantId, id);
              if (!task) throw new ResourceNotFoundError('task', id);
              return task;
            }),
          )
        : await dependencies.store.tasks.list({ tenantId: dependencies.tenantId, limit: 500 });
      const run = await dependencies.store.aiRuns.start({
        tenantId: dependencies.tenantId,
        purpose: 'score-tasks',
        provider: dependencies.ai.provider,
        model: dependencies.ai.model,
        input: { taskIds: tasks.map((task) => task.id) },
      });
      try {
        const manualTaskIds = new Set(
          tasks
            .filter((task) => taskWasManuallyScored(
              dependencies.store,
              dependencies.tenantId,
              task.id,
            ))
            .map((task) => task.id),
        );
        const automaticTasks = tasks.filter((task) => !manualTaskIds.has(task.id));
        const scores = automaticTasks.length > 0
          ? AiTaskScoresSchema.parse(await dependencies.ai.scoreTasks(automaticTasks))
          : [];
        assertScoresMatchTasks(scores, automaticTasks.map((task) => task.id));
        const scoreById = new Map(scores.map((score) => [score.taskId, score]));
        const updated = dependencies.store.transaction((store) => {
          const results = [];
          for (const task of tasks) {
            if (manualTaskIds.has(task.id)) {
              results.push({
                task: projectTask(task),
                explanation: '保留人工设定的评分。',
              });
              continue;
            }
            const score = scoreById.get(task.id);
            if (!score) continue;
            const record = store.tasks.update(
              dependencies.tenantId,
              task.id,
              task.version,
              { scoreDimensions: score.dimensions, score: score.score },
              actorFor(request, 'ai'),
            );
            results.push({ task: projectTask(record), explanation: score.explanation });
          }
          store.aiRuns.complete(
            dependencies.tenantId,
            run.id,
            { scores, manualTaskIds: [...manualTaskIds] },
            'Persisted deterministic task scores',
          );
          return results;
        });
        return { runId: run.id, results: updated };
      } catch (error) {
        await dependencies.store.aiRuns.fail(dependencies.tenantId, run.id, String(error));
        throw aiUnavailable(error);
      }
    });

    app.post('/ai/daily-summary', { schema: docs('Generate the daily summary card', ['ai']) }, async (request) => {
      const body = parseWith(DailySummaryBodySchema, request.body ?? {});
      const date = body.date ?? dateTimeToLocalDate(dependencies.now().toISOString(), timeZone);
      return generateDailySummary(dependencies, date, request.id);
    });

    app.post('/ai/plan-preview', { schema: docs('Compile a safe adaptive schedule proposal', ['ai']) }, async (request) => {
      const body = parseWith(AdaptivePlanBodySchema, request.body);
      const tasks = await dependencies.store.tasks.list({ tenantId: dependencies.tenantId, limit: 500 });
      if (body.allowedTaskIds) {
        const knownIds = new Set(tasks.map((task) => task.id));
        const unknownId = body.allowedTaskIds.find((id) => !knownIds.has(id));
        if (unknownId) throw new ResourceNotFoundError('task', unknownId);
      }
      const taskDependencies = collectDependencies(dependencies, tasks.map((task) => task.id));
      const observedHistory = body.durationHistory ?? tasks.flatMap((task) =>
        task.status === 'completed' && task.estimatedMinutes && task.actualMinutes > 0
          ? [{ estimatedMinutes: task.estimatedMinutes, actualMinutes: task.actualMinutes }]
          : [],
      );
      const memoryEvaluation = evaluateDurationMemory(observedHistory);
      const input = {
        now: dependencies.now().toISOString(),
        tasks,
        dependencies: taskDependencies,
        windows: body.windows,
        ...(body.allowedTaskIds ? { allowedTaskIds: body.allowedTaskIds } : {}),
        ...(memoryEvaluation.status === 'promoted'
          ? { durationHistory: observedHistory.slice(0, memoryEvaluation.evidenceCount) }
          : {}),
        ...(body.previousAssignments ? { previousAssignments: body.previousAssignments } : {}),
        ...(body.freezeBefore ? { freezeBefore: body.freezeBefore } : {}),
        ...(body.defaultEstimatedMinutes
          ? { defaultEstimatedMinutes: body.defaultEstimatedMinutes }
          : {}),
      };
      const run = await dependencies.store.aiRuns.start({
        tenantId: dependencies.tenantId,
        purpose: 'adaptive-plan-preview',
        provider: 'deterministic',
        model: 'lifeos-adaptive-scheduler-v1',
        input,
      });
      try {
        const proposal = compileAdaptivePlan(input);
        const card = dependencies.store.transaction((store) => {
          const created = body.createCard
            ? store.cards.create({
                tenantId: dependencies.tenantId,
                aiRunId: run.id,
                type: proposal.status === 'ready' ? 'action' : 'observation',
                title: proposal.status === 'ready' ? '自适应日程待确认' : '当前日程不可行',
                body: proposal.explanation,
                proposal,
              }, { type: 'ai', correlationId: request.id })
            : null;
          store.aiRuns.complete(
            dependencies.tenantId,
            run.id,
            { proposal, cardId: created?.id ?? null, memoryEvaluation },
            proposal.explanation,
          );
          return created;
        });
        return { runId: run.id, proposal, memoryEvaluation, card };
      } catch (error) {
        await dependencies.store.aiRuns.fail(dependencies.tenantId, run.id, String(error));
        throw aiUnavailable(error);
      }
    });

    app.post('/ai/breakdown-preview', { schema: docs('Compile a task breakdown proposal', ['ai']) }, async (request) => {
      const body = parseWith(TaskBreakdownBodySchema, request.body);
      const parent = await dependencies.store.tasks.get(dependencies.tenantId, body.parentTaskId);
      if (!parent) throw new ResourceNotFoundError('task', body.parentTaskId);
      const run = await dependencies.store.aiRuns.start({
        tenantId: dependencies.tenantId,
        purpose: 'task-breakdown-preview',
        provider: 'proposal-compiler',
        model: 'lifeos-breakdown-gate-v1',
        input: body,
      });
      try {
        const proposal = compileTaskBreakdown(parent, body);
        const card = dependencies.store.transaction((store) => {
          const created = store.cards.create({
            tenantId: dependencies.tenantId,
            targetTaskId: parent.id,
            aiRunId: run.id,
            type: proposal.status === 'ready' ? 'action' : 'observation',
            title: proposal.status === 'ready' ? '任务拆解待确认' : '任务拆解需要修正',
            body: proposal.explanation,
            proposal,
          }, { type: 'ai', correlationId: request.id });
          store.aiRuns.complete(
            dependencies.tenantId,
            run.id,
            { proposal, cardId: created.id },
            proposal.explanation,
          );
          return created;
        });
        return { runId: run.id, proposal, card };
      } catch (error) {
        await dependencies.store.aiRuns.fail(dependencies.tenantId, run.id, String(error));
        throw aiUnavailable(error);
      }
    });
  };
  return plugin;
}

function assertScoresMatchTasks(
  scores: Array<{ taskId: string }>,
  taskIds: string[],
): void {
  const expected = new Set(taskIds);
  const actual = new Set(scores.map((score) => score.taskId));
  if (
    scores.length !== taskIds.length ||
    actual.size !== scores.length ||
    [...actual].some((id) => !expected.has(id))
  ) {
    throw new Error('AI score task ids do not match the request');
  }
}

function collectDependencies(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId'>>,
  taskIds: readonly string[],
): PlanDependency[] {
  const edges = new Map<string, PlanDependency>();
  for (const taskId of taskIds) {
    const listed = dependencies.store.dependencies.listForTask(dependencies.tenantId, taskId);
    for (const item of [...listed.predecessors, ...listed.successors]) {
      const edge = { predecessorId: item.predecessorId, successorId: item.successorId };
      edges.set(`${edge.predecessorId}\u0000${edge.successorId}`, edge);
    }
  }
  return [...edges.values()];
}

async function generateDailySummary(
  dependencies: Required<Pick<AppDependencies, 'store' | 'ai' | 'tenantId'>>,
  date: string,
  correlationId: string,
) {
  const key = `daily-summary:${date}`;
  const existing = await dependencies.store.aiRuns.findByIdempotencyKey(dependencies.tenantId, key);
  if (existing?.status === 'completed') {
    const output = existing.output as { cardId?: string } | null;
    if (output?.cardId) {
      const card = await dependencies.store.cards.get(dependencies.tenantId, output.cardId);
      if (card) return { runId: existing.id, card, reused: true };
    }
  }
  const tasks = tasksForAiContext(
    dependencies.store,
    dependencies.tenantId,
    await dependencies.store.tasks.list({ tenantId: dependencies.tenantId, limit: 500 }),
  );
  const claimToken = randomUUID();
  const runInput = { date, requestToken: claimToken };
  const run =
    existing?.status === 'failed'
      ? await dependencies.store.aiRuns.retry(dependencies.tenantId, existing.id, runInput)
      : await dependencies.store.aiRuns.start({
          tenantId: dependencies.tenantId,
          purpose: 'daily-summary',
          provider: dependencies.ai.provider,
          model: dependencies.ai.model,
          input: runInput,
          idempotencyKey: key,
        });
  const claimedInput = run.input as { requestToken?: string } | null;
  if (claimedInput?.requestToken !== claimToken) {
    const error = new Error('AI_RUN_IN_PROGRESS') as Error & { code: string };
    error.code = 'AI_RUN_IN_PROGRESS';
    throw error;
  }
  try {
    const summary = AiDailySummarySchema.parse(await dependencies.ai.dailySummary(tasks, date));
    const card = dependencies.store.transaction((store) => {
      const created = store.cards.create(
        {
          tenantId: dependencies.tenantId,
          type: 'generation',
          title: summary.title,
          body: summary.body,
          proposal: { kind: 'daily-summary', date, summary },
        },
        { type: 'ai', correlationId },
      );
      store.aiRuns.complete(
        dependencies.tenantId,
        run.id,
        { cardId: created.id, summary },
        summary.explanation,
      );
      return created;
    });
    return { runId: run.id, card, reused: false };
  } catch (error) {
    await dependencies.store.aiRuns.fail(dependencies.tenantId, run.id, String(error));
    throw aiUnavailable(error);
  }
}
