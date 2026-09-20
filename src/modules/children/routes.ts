import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { createChildInput, updateChildInput } from './schema.js';
import { createChild, deleteChild, listChildren, updateChild } from './service.js';

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'children route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function childrenRoutes(app: FastifyInstance): Promise<void> {
  app.get('/children', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await listChildren(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.post('/children', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = createChildInput.parse(req.body);
      return reply.code(201).send(await createChild(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.patch<{ Params: { id: string } }>(
    '/children/:id',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const input = updateChildInput.parse(req.body);
        return reply.code(200).send(await updateChild(req.userId!, req.params.id, input));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/children/:id',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        await deleteChild(req.userId!, req.params.id);
        return reply.code(204).send();
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );
}
