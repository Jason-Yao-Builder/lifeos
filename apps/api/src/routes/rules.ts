import type { RuleProposal } from '@lifeos/contracts';
import { evaluatePresetRules } from '@lifeos/domain';
import type { FastifyPluginAsync } from 'fastify';
import { actorFor, docs, omitUndefined, parseWith } from '../http.js';
import {
  IdParamsSchema,
  LegacyRulePatchBodySchema,
  RuleEvaluateBodySchema,
  RuleListQuerySchema,
  RulePatchBodySchema,
} from '../schemas.js';
import type { ApiStore, AppDependencies, RuleRecord } from '../services.js';

export function ruleRoutes(
  dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId' | 'now'>>,
  timeZone: string,
) {
  const plugin: FastifyPluginAsync = async (app) => {
    app.get('/rules', { schema: docs('List rules', ['rules']) }, async (request) => {
      const { enabled } = parseWith(RuleListQuerySchema, request.query);
      const rules = dependencies.store.rules.list(dependencies.tenantId, enabled);
      return { items: rules.map(projectRule) };
    });

    app.patch('/rules/:id', { schema: docs('Update a rule', ['rules']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const advanced = RulePatchBodySchema.safeParse(request.body);
      const legacy = advanced.success ? null : parseWith(LegacyRulePatchBodySchema, request.body);
      const current = dependencies.store.rules
        .list(dependencies.tenantId)
        .find((rule) => rule.id === id);
      if (!current) {
        const error = new Error(`rule not found: ${id}`) as Error & { code: string };
        error.code = 'NOT_FOUND';
        throw error;
      }
      const version = advanced.success ? advanced.data.version : current.version;
      const patch = advanced.success
        ? omitUndefined(advanced.data.patch)
        : {
            ...(legacy?.enabled === undefined ? {} : { enabled: legacy.enabled }),
            ...(legacy?.parameters === undefined ? {} : { config: legacy.parameters }),
          };
      const updated = dependencies.store.rules.update(
        dependencies.tenantId,
        id,
        version,
        patch,
        actorFor(request),
      );
      return projectRule(updated);
    });

    app.post('/rules/evaluate', { schema: docs('Evaluate preset rules', ['rules']) }, async (request) => {
      const body = parseWith(RuleEvaluateBodySchema, request.body ?? {});
      const now = body.now ?? dependencies.now().toISOString();
      const [tasks, rules] = await Promise.all([
        dependencies.store.tasks.list({ tenantId: dependencies.tenantId, limit: 500 }),
        dependencies.store.rules.list(dependencies.tenantId, true),
      ]);
      const enabledIds = new Set(rules.map((rule) => rule.id));
      const proposals = evaluatePresetRules(tasks, {
        now,
        timeZone,
        deadlineDays: configDays(rules, 'deadline-auto-heat', 3),
        staleDays: configDays(rules, 'stale-task-observation', 7),
      }).filter((proposal) => enabledIds.has(proposal.ruleId));
      return dependencies.store.transaction((store) =>
        applyProposals(store, dependencies.tenantId, proposals, request.id),
      );
    });
  };
  return plugin;
}

function configDays(rules: RuleRecord[], id: string, fallback: number): number {
  const config = rules.find((rule) => rule.id === id)?.config;
  if (!config || typeof config !== 'object') return fallback;
  const days = (config as Record<string, unknown>).days;
  return Number.isInteger(days) && Number(days) >= 0 ? Number(days) : fallback;
}

function projectRule(rule: RuleRecord) {
  const parameters =
    rule.config && typeof rule.config === 'object' && !Array.isArray(rule.config)
      ? rule.config
      : {};
  return {
    id: rule.id,
    name: rule.name,
    description: describeRule(rule),
    enabled: rule.enabled,
    parameters,
    lastTriggeredAt: null,
    version: rule.version,
  };
}

function describeRule(rule: RuleRecord): string {
  if (rule.id === 'deadline-auto-heat') return '截止日前自动将硬任务升为热任务';
  if (rule.id === 'stale-task-observation') return '任务长期未变化时生成观察卡片';
  if (rule.id === 'friday-hot-demotion') return '周五建议将未完成热任务降为温任务';
  return '可配置自动化规则';
}

function applyProposals(
  store: ApiStore,
  tenantId: string,
  proposals: RuleProposal[],
  correlationId: string,
) {
  const appliedTaskIds: string[] = [];
  const cardIds: string[] = [];

  for (const proposal of proposals) {
    const idempotencyKey = `rule:${proposal.idempotencyKey}`;
    if (store.aiRuns.findByIdempotencyKey(tenantId, idempotencyKey)) continue;
    const run = store.aiRuns.start({
      tenantId,
      purpose: 'rule-evaluation',
      provider: 'rule-engine',
      model: proposal.ruleId,
      input: proposal,
      idempotencyKey,
    });
    let output: Record<string, unknown> = { action: proposal.action.type };
    if (proposal.action.type === 'change_temperature' && !proposal.action.requireConfirmation) {
      const task = store.tasks.get(tenantId, proposal.taskId);
      if (task && task.temperature !== proposal.action.value) {
        store.tasks.update(
          tenantId,
          task.id,
          task.version,
          { temperature: proposal.action.value },
          { type: 'rule', correlationId },
        );
        appliedTaskIds.push(task.id);
        output = { ...output, taskId: task.id, applied: true };
      } else {
        output = { ...output, taskId: proposal.taskId, applied: false };
      }
    } else {
      const card = store.cards.create(
        { ...cardInputFor(proposal, tenantId), aiRunId: run.id },
        { type: 'rule', correlationId },
      );
      cardIds.push(card.id);
      output = { ...output, cardId: card.id };
    }
    store.aiRuns.complete(
      tenantId,
      run.id,
      output,
      proposal.reason,
    );
  }
  return { proposals, appliedTaskIds, cardIds };
}

function cardInputFor(proposal: RuleProposal, tenantId: string) {
  const action = proposal.action;
  if (action.type === 'create_card') {
    return {
      tenantId,
      targetTaskId: proposal.taskId,
      type: action.cardType,
      title: action.title,
      body: action.body,
      proposal,
    } as const;
  }
  return {
    tenantId,
    targetTaskId: proposal.taskId,
    type: 'action',
    title: 'Review task temperature',
    body: proposal.reason,
    proposal,
  } as const;
}
