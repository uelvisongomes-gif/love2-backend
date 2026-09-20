import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import { AppError } from '../../errors.js';
import {
  createChallenge,
  deleteChallenge,
  getMyPerception,
  getNarrative,
  getPartnerPerception,
  listMyChallenges,
  listPartnerVisibleChallenges,
  updateChallenge,
  upsertMyPerception,
  upsertNarrative,
} from './service.js';

const nullableStr = (max: number) => z.string().max(max).nullable().optional();

const narrativeInput = z
  .object({
    ourVision: nullableStr(3000),
    ourHistory: nullableStr(5000),
    ourValues: nullableStr(3000),
    connectionRituals: nullableStr(3000),
  })
  .strict();

const perceptionInput = z
  .object({
    admiration: nullableStr(2000),
    gratitude: nullableStr(2000),
    worries: nullableStr(2000),
    hopes: nullableStr(2000),
    visibleToPartner: z.boolean().optional(),
  })
  .strict();

const challengeCreate = z
  .object({
    title: z.string().min(1).max(200),
    description: nullableStr(2000),
    visibleToPartner: z.boolean().optional(),
  })
  .strict();

const challengeUpdate = challengeCreate.partial();

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'nos route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function nosRoutes(app: FastifyInstance): Promise<void> {
  // Narrativa do casal
  app.get('/nos/narrative', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getNarrative(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.put('/nos/narrative', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = narrativeInput.parse(req.body);
      return reply.code(200).send(await upsertNarrative(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  // Minha percepção
  app.get('/nos/perception/me', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getMyPerception(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.put('/nos/perception/me', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = perceptionInput.parse(req.body);
      return reply.code(200).send(await upsertMyPerception(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  // Percepção do parceiro (só o visível)
  app.get('/nos/perception/partner', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getPartnerPerception(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  // Desafios
  app.get('/nos/challenges', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await listMyChallenges(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.post('/nos/challenges', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = challengeCreate.parse(req.body);
      return reply.code(201).send(await createChallenge(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.patch<{ Params: { id: string } }>(
    '/nos/challenges/:id',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const input = challengeUpdate.parse(req.body);
        return reply.code(200).send(await updateChallenge(req.userId!, req.params.id, input));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/nos/challenges/:id',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        await deleteChallenge(req.userId!, req.params.id);
        return reply.code(204).send();
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.get('/nos/challenges/partner', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await listPartnerVisibleChallenges(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
