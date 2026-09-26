import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { createSession, endSession, getSession, sendMessage } from './service.js';

const createInput = z.object({ topic: z.string().max(200).optional() }).strict();
const sendInput = z.object({ content: z.string().min(1).max(4000) }).strict();
const getQuery = z.object({ since: z.string().datetime().optional() }).strict();

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'livemediation route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function liveMediationRoutes(app: FastifyInstance): Promise<void> {
  app.post('/live-mediation', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = createInput.parse(req.body ?? {});
      return reply.code(201).send(await createSession(req.userId!, input.topic));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get<{ Params: { id: string } }>(
    '/live-mediation/:id',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const q = getQuery.parse(req.query ?? {});
        return reply.code(200).send(await getSession(req.userId!, req.params.id, q.since));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/live-mediation/:id/message',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const input = sendInput.parse(req.body);
        return reply
          .code(200)
          .send(await sendMessage(req.userId!, req.params.id, input.content));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/live-mediation/:id/end',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(200).send(await endSession(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );
}
