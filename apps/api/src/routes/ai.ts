import { randomUUID } from 'node:crypto';
import { dateTimeToLocalDate } from '@lifeos/domain';
import type { FastifyPluginAsync } from 'fastify';
import { ResourceNotFoundError, actorFor, docs, parseWith, projectTask } from '../http.js';
import {
  AiDailySummarySchema,
  AiTaskScoresSchema,
  DailySummaryBodySchema,
  ScoreTasksBodySchema,
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
        const scores = AiTaskScoresSchema.parse(await dependencies.ai.scoreTasks(tasks));
        assertScoresMatchTasks(scores, tasks.map((task) => task.id));
        const scoreById = new Map(scores.map((score) => [score.taskId, score]));
        const updated = dependencies.store.transaction((store) => {
          const results = [];
          for (const task of tasks) {
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
            { scores },
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
  const tasks = await dependencies.store.tasks.list({ tenantId: dependencies.tenantId, limit: 500 });
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
