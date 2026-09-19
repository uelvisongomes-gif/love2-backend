import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError, z } from 'zod';
import { AppError } from '../../errors.js';
import {
  MEDIATION_STEPS,
  acceptAgreement,
  cancelSession,
  createSession,
  generateSynthesis,
  getSession,
  listSessions,
  submitStep,
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
  log.error({ err }, 'mediation route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

const createInput = z.object({ topic: z.string().max(200).optional() }).strict();
const stepInput = z
  .object({
    step: z.enum(MEDIATION_STEPS),
    answer: z.string().min(1).max(4000),
  })
  .strict();
const acceptInput = z
  .object({
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(4000),
  })
  .strict();

export async function mediationRoutes(app: FastifyInstance): Promise<void> {
  app.post('/mediation', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = createInput.parse(req.body);
      return reply.code(201).send(await createSession(req.userId!, input.topic));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/mediation', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await listSessions(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get<{ Params: { id: string } }>(
    '/mediation/:id',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(200).send(await getSession(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/mediation/:id/step',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const input = stepInput.parse(req.body);
        return reply.code(201).send(await submitStep(req.userId!, req.params.id, input.step, input.answer));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/mediation/:id/synthesize',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(200).send(await generateSynthesis(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/mediation/:id/accept',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const input = acceptInput.parse(req.body);
        return reply.code(200).send(await acceptAgreement(req.userId!, req.params.id, input.title, input.content));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/mediation/:id/cancel',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(200).send(await cancelSession(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );
}
