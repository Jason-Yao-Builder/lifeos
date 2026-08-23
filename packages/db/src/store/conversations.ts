import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { NotFoundError } from '../errors.js';
import { encodeJson } from '../json.js';
import { cards, conversations, messages } from '../schema.js';
import type {
  ActorInput,
  ConversationRecord,
  MessageRecord,
  MessageRole,
} from '../types.js';
import { DEFAULT_TENANT_ID } from '../types.js';
import { appendEvent } from './events.js';
import { mapCard, mapConversation, mapMessage } from './mappers.js';
import { atomic, type StoreRuntime } from './runtime.js';

export interface CreateConversationInput {
  id?: string;
  tenantId?: string;
  cardId?: string | null;
  title?: string | null;
}

export interface AddMessageInput {
  id?: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  metadata?: unknown;
}

export interface ConversationOperations {
  list(tenantId?: string, limit?: number): ConversationRecord[];
  get(tenantId: string, id: string): ConversationRecord | null;
  create(input: CreateConversationInput, actor?: ActorInput): ConversationRecord;
  listMessages(conversationId: string): MessageRecord[];
  addMessage(input: AddMessageInput, actor?: ActorInput): MessageRecord;
}

export function createConversationOperations(runtime: StoreRuntime): ConversationOperations {
  return {
    list(tenantId = DEFAULT_TENANT_ID, limit = 100) {
      return runtime.executor
        .select()
        .from(conversations)
        .where(eq(conversations.workspaceId, tenantId))
        .orderBy(desc(conversations.updatedAt))
        .limit(Math.min(Math.max(limit, 1), 500))
        .all()
        .map(mapConversation);
    },
    get(tenantId, id) {
      const row = runtime.executor
        .select()
        .from(conversations)
        .where(and(eq(conversations.workspaceId, tenantId), eq(conversations.id, id)))
        .get();
      return row ? mapConversation(row) : null;
    },
    create(input, actor) {
      return atomic(runtime, (tx) => {
        const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
        const now = runtime.now().toISOString();
        const row = tx
          .insert(conversations)
          .values({
            id: input.id ?? randomUUID(),
            workspaceId: tenantId,
            cardId: input.cardId ?? null,
            title: input.title ?? null,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        if (row.cardId) {
          const card = tx.select().from(cards).where(and(eq(cards.id, row.cardId), eq(cards.workspaceId, tenantId))).get();
          if (!card) throw new NotFoundError('card', row.cardId);
          const updatedCard = tx.update(cards).set({ hasDiscussion: true, status: card.status === 'pending' ? 'discussing' : card.status, updatedAt: now, version: card.version + 1 }).where(eq(cards.id, card.id)).returning().get();
          appendEvent(tx, {
            tenantId,
            aggregateType: 'card',
            aggregateId: card.id,
            type: 'card.discussion_started',
            actor,
            before: mapCard(card),
            after: mapCard(updatedCard),
          }, runtime.now);
        }
        const record = mapConversation(row);
        appendEvent(tx, { tenantId, aggregateType: 'conversation', aggregateId: row.id, type: 'conversation.created', actor, after: record }, runtime.now);
        return record;
      });
    },
    listMessages(conversationId) {
      return runtime.executor
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.createdAt))
        .all()
        .map(mapMessage);
    },
    addMessage(input, actor) {
      return atomic(runtime, (tx) => {
        const conversation = tx.select().from(conversations).where(eq(conversations.id, input.conversationId)).get();
        if (!conversation) throw new NotFoundError('conversation', input.conversationId);
        const now = runtime.now().toISOString();
        const row = tx.insert(messages).values({ id: input.id ?? randomUUID(), conversationId: input.conversationId, role: input.role, content: input.content, metadataJson: encodeJson(input.metadata), createdAt: now }).returning().get();
        tx.update(conversations).set({ updatedAt: now }).where(eq(conversations.id, conversation.id)).run();
        const record = mapMessage(row);
        appendEvent(tx, { tenantId: conversation.workspaceId, aggregateType: 'conversation', aggregateId: conversation.id, type: 'message.created', actor, after: record }, runtime.now);
        return record;
      });
    },
  };
}
