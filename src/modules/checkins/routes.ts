import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { checkinTodayInput } from './schema.js';
import { last7Days, upsertTodayCheckin } from './service.js';

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'checkin route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function checkinsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/checkins/today', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = checkinTodayInput.parse(req.body);
      const c = await upsertTodayCheckin(req.userId!, input);
      return reply.code(201).send(c);
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/checkins/last-7-days', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await last7Days(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
