import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { loadConfig } from '../../config.js';
import { subscribeInput, unsubscribeInput } from './schema.js';
import { subscribe, unsubscribe, sendTestNotification, runReminderScheduler } from './service.js';

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'push route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  app.get('/push/public-key', async (_req, reply) => {
    const cfg = loadConfig();
    return reply.code(200).send({ publicKey: cfg.VAPID_PUBLIC_KEY ?? null });
  });

  app.post('/push/subscribe', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = subscribeInput.parse(req.body);
      const sub = await subscribe(req.userId!, input);
      return reply.code(201).send({ id: sub.id });
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.post('/push/unsubscribe', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = unsubscribeInput.parse(req.body);
      await unsubscribe(input.endpoint);
      return reply.code(204).send();
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  // Envia uma notificação de teste AGORA pro user logado
  app.post('/push/test', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const result = await sendTestNotification(req.userId!);
      return reply.code(200).send(result);
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  // Força o scheduler a rodar agora (útil pra debug)
  app.post('/push/run-scheduler', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const r = await runReminderScheduler();
      return reply.code(200).send(r);
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
