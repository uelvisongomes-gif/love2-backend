import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { parseWebhook } from '@raphaelvserafim/client-api-whatsapp';
import { AppError } from '../../errors.js';
import { loadConfig } from '../../config.js';
import {
  generateLinkCode,
  getLinkStatus,
  handleIncoming,
  unlinkPhone,
} from './service.js';

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'wame route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

function isWebhookAuthorized(req: FastifyRequest): boolean {
  const cfg = loadConfig();
  const secret = cfg.WAME_WEBHOOK_SECRET;
  if (!secret) return true; // sem secret configurado — não valida (dev)
  const provided = req.headers['x-webhook-secret'] ?? req.headers['x-wame-secret'];
  return typeof provided === 'string' && provided === secret;
}

export async function wameRoutes(app: FastifyInstance): Promise<void> {
  // === WEBHOOK PÚBLICO ===
  // A WAME manda eventos aqui. Retorna 200 sempre pra ela não retentar.
  app.post('/webhooks/wame', async (req, reply) => {
    if (!isWebhookAuthorized(req)) {
      req.log.warn('[wame] webhook unauthorized');
      return reply.code(401).send({ ok: false });
    }
    // Responde já pra WAME (evita timeout) e processa em background
    reply.code(200).send({ ok: true });

    try {
      req.log.info({ bodyKeys: Object.keys(req.body ?? {}) }, '[wame] webhook received');
      const events = parseWebhook(req.body);
      req.log.info({ eventsCount: events.length, eventsSummary: events.map((e) => ({ field: (e as { field?: string }).field, type: (e as { type?: string }).type })) }, '[wame] events parsed');

      if (events.length === 0) {
        req.log.warn({ rawBody: req.body }, '[wame] parseWebhook returned 0 events — payload shape unexpected');
      }

      for (const ev of events) {
        if (ev.field !== 'messages') {
          req.log.info({ field: ev.field }, '[wame] skipping non-messages event');
          continue;
        }
        if (ev.type === 'status') {
          req.log.info('[wame] skipping status event');
          continue;
        }
        if (!('type' in ev)) {
          req.log.info({ ev }, '[wame] skipping unknown event');
          continue;
        }
        const msg = ev as typeof ev & { fromMe?: boolean; chatType?: string; from?: string };
        if (msg.fromMe) {
          req.log.info('[wame] skipping fromMe (echo)');
          continue;
        }
        if (msg.chatType === 'group') {
          req.log.info('[wame] skipping group message');
          continue;
        }

        if (ev.type === 'text') {
          req.log.info({ from: ev.from, textPreview: ev.text.body.slice(0, 40) }, '[wame] processing text');
          await handleIncoming({
            wamId: ev.messageId,
            from: ev.from,
            text: ev.text.body,
            raw: ev,
          });
        } else if (ev.type === 'audio') {
          const audioId = ev.audio.id;
          if (!audioId) {
            req.log.warn({ ev }, '[wame] audio sem id');
            continue;
          }
          req.log.info({ from: ev.from, audioId }, '[wame] processing audio');
          await handleIncoming({
            wamId: ev.messageId,
            from: ev.from,
            audioId,
            raw: ev,
          });
        } else {
          req.log.info({ type: ev.type }, '[wame] tipo não suportado');
        }
      }
    } catch (err) {
      req.log.error({ err }, '[wame] webhook processing failed');
    }
  });

  // === APIs autenticadas do app ===
  app.get('/wame/status', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getLinkStatus(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.post('/wame/link', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const res = await generateLinkCode(req.userId!);
      return reply.code(200).send(res);
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.delete('/wame/link', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      await unlinkPhone(req.userId!);
      return reply.code(204).send();
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
