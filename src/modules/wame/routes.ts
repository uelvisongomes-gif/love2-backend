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
      const events = parseWebhook(req.body);
      for (const ev of events) {
        if (ev.field !== 'messages') continue;
        if (ev.type === 'status') continue; // delivery/read receipts
        // Narrowing: WebhookMessageEvent tem fromMe e chatType; UnknownEvent não
        if (!('type' in ev)) continue;
        const msg = ev as typeof ev & { fromMe?: boolean; chatType?: string };
        if (msg.fromMe) continue;
        if (msg.chatType === 'group') continue;

        if (ev.type === 'text') {
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
          await handleIncoming({
            wamId: ev.messageId,
            from: ev.from,
            audioId,
            raw: ev,
          });
        }
        // outros tipos (image, video, etc): por enquanto responde "só texto e áudio"
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
