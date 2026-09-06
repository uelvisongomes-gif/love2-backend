import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { upsertProfileInput } from './schema.js';
import { getAllowedTopics, getProfile, upsertProfile } from './service.js';

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'profile route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.put('/profile', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = upsertProfileInput.parse(req.body);
      await upsertProfile(req.userId!, input);
      return reply.code(200).send({ ok: true });
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/profile', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getProfile(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/profile/allowed-topics', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getAllowedTopics(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
