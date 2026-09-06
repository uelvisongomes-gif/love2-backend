import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { conflictMessageInput, createConflictInput } from './schema.js';
import { createConflict, getConflict, listConflicts, postMessage } from './service.js';

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
}
