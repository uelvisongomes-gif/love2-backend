import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { createLifeInput, listLifeQuery, updateLifeInput } from './schema.js';
import { createLife, deleteLife, listLife, toggleDone, updateLife } from './service.js';

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'life route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function lifeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/life', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = createLifeInput.parse(req.body);
      return reply.code(201).send(await createLife(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/life', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const q = listLifeQuery.parse(req.query);
      return reply.code(200).send(await listLife(req.userId!, q));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.patch<{ Params: { id: string } }>('/life/:id', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = updateLifeInput.parse(req.body);
      return reply.code(200).send(await updateLife(req.userId!, req.params.id, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.post<{ Params: { id: string } }>('/life/:id/toggle-done', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await toggleDone(req.userId!, req.params.id));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.delete<{ Params: { id: string } }>('/life/:id', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      await deleteLife(req.userId!, req.params.id);
      return reply.code(204).send();
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
