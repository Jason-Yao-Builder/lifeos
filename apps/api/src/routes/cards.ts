import { RuleProposalSchema } from '@lifeos/contracts';
import { InvalidTransitionError, canTransitionCardStatus } from '@lifeos/domain';
import type { FastifyPluginAsync } from 'fastify';
import { ResourceNotFoundError, actorFor, docs, omitUndefined, parseWith } from '../http.js';
import {
  CardDecisionBodySchema,
  CardDiscussBodySchema,
  CardListQuerySchema,
  IdParamsSchema,
} from '../schemas.js';
import type { ApiStore, AppDependencies, StoredCard } from '../services.js';

export function cardRoutes(dependencies: Required<Pick<AppDependencies, 'store' | 'tenantId'>>) {
  const plugin: FastifyPluginAsync = async (app) => {
    app.get('/cards', { schema: docs('List cards', ['cards']) }, async (request) => {
      const query = parseWith(CardListQuerySchema, request.query);
      const cards = dependencies.store.cards.list({
        ...omitUndefined(query),
        tenantId: dependencies.tenantId,
      });
      const conversations = dependencies.store.conversations.list(dependencies.tenantId, 500);
      const conversationByCard = new Map(
        conversations
          .filter((conversation) => conversation.cardId !== null)
          .map((conversation) => [conversation.cardId, conversation]),
      );
      return {
        items: cards.map((card) => {
          const conversation = conversationByCard.get(card.id);
          return {
            ...card,
            ...(conversation
              ? {
                  conversationId: conversation.id,
                  messages: dependencies.store.conversations.listMessages(conversation.id),
                }
              : {}),
          };
        }),
      };
    });

    app.post('/cards/:id/decision', { schema: docs('Decide a card', ['cards']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const body = parseWith(CardDecisionBodySchema, request.body);
      return dependencies.store.transaction((store) => {
        const card = store.cards.get(dependencies.tenantId, id);
        if (!card) throw new ResourceNotFoundError('card', id);
        const legacy = !('status' in body);
        const status = legacy ? (body.decision === 'accept' ? 'accepted' : 'rejected') : body.status;
        if (card.status === status && ['accepted', 'rejected'].includes(status)) return card;
        if (!canTransitionCardStatus(card.status, status)) {
          throw new InvalidTransitionError('card', card.status, status);
        }
        if (status === 'accepted') {
          applyAcceptedProposal(store, dependencies.tenantId, card, request.id);
        }
        return store.cards.decide(
          dependencies.tenantId,
          id,
          legacy ? card.version : body.version,
          status,
          legacy ? { choice: body.decision } : body.decision,
          actorFor(request),
        );
      });
    });

    app.post('/cards/:id/discuss', { schema: docs('Discuss a card', ['cards']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const body = parseWith(CardDiscussBodySchema, request.body ?? {});
      const card = await dependencies.store.cards.get(dependencies.tenantId, id);
      if (!card) throw new ResourceNotFoundError('card', id);
      const existing = dependencies.store.conversations.list(dependencies.tenantId, 500).find(
        (conversation) => conversation.cardId === id,
      );
      const conversation =
        existing ??
        dependencies.store.conversations.create(
          {
            id: `card-${id}`,
            tenantId: dependencies.tenantId,
            cardId: id,
            title: body.title ?? card.title,
          },
          actorFor(request),
        );
      const message = body.message
        ? dependencies.store.conversations.addMessage(
            { conversationId: conversation.id, role: 'user', content: body.message },
            actorFor(request),
          )
        : null;
      return { conversationId: conversation.id, conversation, message };
    });
  };
  return plugin;
}

function applyAcceptedProposal(
  store: ApiStore,
  tenantId: string,
  card: StoredCard,
  correlationId: string,
): void {
  const proposal = RuleProposalSchema.safeParse(card.proposal);
  if (!proposal.success || proposal.data.action.type !== 'change_temperature') return;
  const task = store.tasks.get(tenantId, proposal.data.taskId);
  if (!task) throw new ResourceNotFoundError('task', proposal.data.taskId);
  if (task.temperature === proposal.data.action.value) return;
  store.tasks.update(
    tenantId,
    task.id,
    task.version,
    { temperature: proposal.data.action.value },
    { type: 'human', correlationId },
  );
}
