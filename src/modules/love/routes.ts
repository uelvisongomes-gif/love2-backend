import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { chatWithLove } from '../../ai/orchestrator.js';
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { CURRENT_CONSENT_VERSIONS } from '../consent/service.js';
import { chatInput } from './schema.js';

async function assertLoveConsent(userId: string): Promise<void> {
  const required = CURRENT_CONSENT_VERSIONS.disclaimer_love_not_therapist;
  const hit = await prisma.consent.findFirst({
    where: { userId, scope: 'disclaimer_love_not_therapist', version: required },
  });
  if (!hit) {
    throw new AppError('CONSENT_REQUIRED', 'Aceite o disclaimer da LOVE para conversar', 403);
  }
}

export async function loveRoutes(app: FastifyInstance): Promise<void> {
  app.post('/love/chat', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = chatInput.parse(req.body);
      await assertLoveConsent(req.userId!);
      const result = await chatWithLove({
        userId: req.userId!,
        content: input.content,
        context: input.context,
      });
      return reply.code(200).send({
        reply: result.reply,
        safety: { category: result.safety.category, source: result.safety.source },
        citations: result.citations,
        messageId: result.messageId,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
        });
      }
      if (err instanceof AppError) {
        return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      }
      req.log.error({ err }, 'love/chat failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });
}
