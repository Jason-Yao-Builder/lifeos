import type { FastifyPluginAsync } from 'fastify';
import {
  ResourceNotFoundError,
  actorFor,
  docs,
  omitUndefined,
  parseWith,
  tasksForAiContext,
} from '../http.js';
import {
  AddMessageBodySchema,
  AiChatReplySchema,
  ConversationListQuerySchema,
  CreateConversationBodySchema,
  IdParamsSchema,
} from '../schemas.js';
import type { AppDependencies } from '../services.js';

export function conversationRoutes(
  dependencies: Required<Pick<AppDependencies, 'store' | 'ai' | 'tenantId'>>,
) {
  const plugin: FastifyPluginAsync = async (app) => {
    app.get('/conversations', { schema: docs('List conversations', ['conversations']) }, async (request) => {
      const { limit } = parseWith(ConversationListQuerySchema, request.query);
      return { items: dependencies.store.conversations.list(dependencies.tenantId, limit) };
    });

    app.post('/conversations', { schema: docs('Create a conversation', ['conversations']) }, async (request, reply) => {
      const body = parseWith(CreateConversationBodySchema, request.body ?? {});
      const conversation = await dependencies.store.conversations.create(
        { ...omitUndefined(body), tenantId: dependencies.tenantId },
        actorFor(request),
      );
      return reply.status(201).send(conversation);
    });

    app.get('/conversations/:id/messages', { schema: docs('List messages', ['conversations']) }, async (request) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const conversation = await dependencies.store.conversations.get(dependencies.tenantId, id);
      if (!conversation) throw new ResourceNotFoundError('conversation', id);
      return { items: dependencies.store.conversations.listMessages(id) };
    });

    app.post('/conversations/:id/messages', { schema: docs('Add a message', ['conversations']) }, async (request, reply) => {
      const { id } = parseWith(IdParamsSchema, request.params);
      const body = parseWith(AddMessageBodySchema, request.body);
      const conversation = await dependencies.store.conversations.get(dependencies.tenantId, id);
      if (!conversation) throw new ResourceNotFoundError('conversation', id);
      if (body.role !== 'user') {
        const message = dependencies.store.conversations.addMessage(
          { conversationId: id, ...body },
          actorFor(request, body.role === 'assistant' ? 'ai' : 'system'),
        );
        return reply.status(201).send({ message });
      }

      const history = dependencies.store.conversations.listMessages(id);
      const tasks = tasksForAiContext(
        dependencies.store,
        dependencies.tenantId,
        dependencies.store.tasks.list({ tenantId: dependencies.tenantId, limit: 500 }),
      );
      const nextMessages: Array<{
        role: 'system' | 'user' | 'assistant';
        content: string;
      }> = [...history, { role: 'user', content: body.content }];
      const aiReplyResult = await dependencies.ai.reply({
        messages: nextMessages.map(({ role, content }) => ({
          role,
          content,
        })),
        tasks,
      });
      const aiReply = AiChatReplySchema.safeParse(aiReplyResult);
      if (!aiReply.success) {
        const error = new Error('AI reply failed validation') as Error & { code: string };
        error.code = 'AI_UNAVAILABLE';
        throw error;
      }
      const result = dependencies.store.transaction((store) => {
        store.conversations.addMessage(
          {
            conversationId: id,
            role: 'user',
            content: body.content,
            ...omitUndefined({ metadata: body.metadata }),
          },
          actorFor(request),
        );
        return store.conversations.addMessage(
          {
            conversationId: id,
            role: 'assistant',
            content: aiReply.data.content,
            metadata: { explanation: aiReply.data.explanation },
          },
          actorFor(request, 'ai'),
        );
      });
      return reply.status(201).send({ message: result });
    });
  };
  return plugin;
}
