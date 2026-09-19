import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { z } from 'zod';
import { AppError } from '../../errors.js';
import { checkinTodayInput, checkinV2Input } from './schema.js';
import {
  checkinHistory,
  last7Days,
  upsertTodayCheckin,
  upsertTodayCheckinV2,
} from './service.js';

const historyQuery = z
  .object({ days: z.coerce.number().int().positive().max(90).default(14) })
  .strict();

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

  app.post('/checkins/v2/today', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = checkinV2Input.parse(req.body);
      const c = await upsertTodayCheckinV2(req.userId!, input);
      return reply.code(201).send(c);
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/checkins/v2/history', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const { days } = historyQuery.parse(req.query);
      return reply.code(200).send(await checkinHistory(req.userId!, days));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
