import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { conflictMessageInput, createConflictInput } from './schema.js';
import { createConflict, getConflict, listConflicts, postMessage } from './service.js';
import { generateBlocks, listBlocks, updateBlock, updateBlockInput } from './blocks.js';
import { getAuthorizedSummary, openPonte, ponteRespondInput, respondPonte } from './ponte.js';
import { crossReference, getInsight } from './cross-ref.js';

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'conflict route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function conflictsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/conflicts', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = createConflictInput.parse(req.body);
      return reply.code(201).send(await createConflict(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.post<{ Params: { id: string } }>(
    '/conflicts/:id/messages',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const input = conflictMessageInput.parse(req.body);
        return reply.code(201).send(await postMessage(req.userId!, req.params.id, input));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.get<{ Params: { id: string } }>('/conflicts/:id', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getConflict(req.userId!, req.params.id));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/conflicts', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await listConflicts(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.post<{ Params: { id: string } }>(
    '/conflicts/:id/blocks/generate',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(201).send(await generateBlocks(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/conflicts/:id/blocks',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(200).send(await listBlocks(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.patch<{ Params: { id: string; blockId: string } }>(
    '/conflicts/:id/blocks/:blockId',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const input = updateBlockInput.parse(req.body);
        return reply.code(200).send(await updateBlock(req.userId!, req.params.id, req.params.blockId, input));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/conflicts/:id/ponte/open',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(200).send(await openPonte(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/conflicts/:id/ponte/respond',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const input = ponteRespondInput.parse(req.body);
        return reply.code(200).send(await respondPonte(req.userId!, req.params.id, input));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/conflicts/:id/authorized-summary',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(200).send(await getAuthorizedSummary(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/conflicts/:id/cross-reference',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(200).send(await crossReference(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/conflicts/:id/insight',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(200).send(await getInsight(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );
}
