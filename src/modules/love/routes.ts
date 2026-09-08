import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { z } from 'zod';
import { chatWithLove } from '../../ai/orchestrator.js';
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { loadConfig } from '../../config.js';
import { CURRENT_CONSENT_VERSIONS } from '../consent/service.js';
import { chatInput } from './schema.js';

const ttsInput = z
  .object({
    text: z.string().min(1).max(4000),
    voice: z.enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']).default('nova'),
  })
  .strict();

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

  app.post('/love/tts', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = ttsInput.parse(req.body);
      const cfg = loadConfig();
      if (!cfg.OPENAI_API_KEY) {
        return reply.code(503).send({ error: { code: 'TTS_UNAVAILABLE', message: 'TTS não configurado' } });
      }
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          voice: input.voice,
          input: input.text,
          response_format: 'mp3',
          speed: 1.05,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        req.log.error({ status: res.status, body }, 'openai tts failed');
        return reply.code(502).send({ error: { code: 'TTS_FAILED', message: 'Falha ao gerar áudio' } });
      }
      const audioBuffer = Buffer.from(await res.arrayBuffer());
      return reply
        .code(200)
        .header('Content-Type', 'audio/mpeg')
        .header('Cache-Control', 'no-store')
        .send(audioBuffer);
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
        });
      }
      req.log.error({ err }, 'love/tts failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });
}
