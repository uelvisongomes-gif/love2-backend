import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { dailyLogInput, logPeriodInput, updateProfileInput } from './schema.js';
import {
  deletePeriod,
  getOrCreateProfile,
  listDailyLogs,
  listPeriods,
  logPeriod,
  partnerView,
  predict,
  updateProfile,
  upsertDailyLog,
} from './service.js';

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'cycle route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function cycleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/cycle/profile', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getOrCreateProfile(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.patch('/cycle/profile', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = updateProfileInput.parse(req.body);
      return reply.code(200).send(await updateProfile(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/cycle/periods', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await listPeriods(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.post('/cycle/periods', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = logPeriodInput.parse(req.body);
      return reply.code(201).send(await logPeriod(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.delete<{ Params: { id: string } }>('/cycle/periods/:id', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      await deletePeriod(req.userId!, req.params.id);
      return reply.code(204).send();
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/cycle/logs', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await listDailyLogs(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.post('/cycle/logs', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = dailyLogInput.parse(req.body);
      return reply.code(201).send(await upsertDailyLog(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/cycle/predict', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await predict(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/cycle/partner', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await partnerView(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
