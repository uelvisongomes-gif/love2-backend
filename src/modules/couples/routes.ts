import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { acceptInput, inviteInput } from './schema.js';
import { acceptInvite, createInvite, getMyCouple } from './service.js';

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'couples route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function couplesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/couples/invite', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = inviteInput.parse(req.body);
      return reply.code(201).send(await createInvite(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.post('/couples/accept', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = acceptInput.parse(req.body);
      return reply.code(200).send(await acceptInvite(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/couples/me', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getMyCouple(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
