import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { upsertProfileInput, uploadPhotoInput } from './schema.js';
import {
  getAllowedTopics,
  getProfile,
  upsertProfile,
  updateUserPhoto,
  removeUserPhoto,
  getUserBasic,
} from './service.js';
import { getSafetyScreening, safetyScreeningInput, submitSafetyScreening } from './safety-screening.js';

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

  app.post('/profile/safety-screening', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = safetyScreeningInput.parse(req.body);
      return reply.code(200).send(await submitSafetyScreening(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/profile/safety-screening', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getSafetyScreening(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  // Etapa 2 — foto do usuário e dados básicos
  app.get('/me', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getUserBasic(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.put('/me/photo', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const { photoUrl } = uploadPhotoInput.parse(req.body);
      await updateUserPhoto(req.userId!, photoUrl);
      return reply.code(200).send({ ok: true });
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.delete('/me/photo', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      await removeUserPhoto(req.userId!);
      return reply.code(200).send({ ok: true });
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
