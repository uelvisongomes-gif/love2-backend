import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import { AppError } from '../../errors.js';
import {
  createEntry,
  deleteEntry,
  hasPin,
  listEntries,
  setPin,
  updateEntry,
  verifyPin,
} from './service.js';

const setPinInput = z
  .object({
    pin: z.string().min(4).max(20),
    currentPin: z.string().min(4).max(20).optional(),
  })
  .strict();

const verifyInput = z.object({ pin: z.string().min(4).max(20) }).strict();

const entryCreate = z
  .object({
    title: z.string().min(1).max(200),
    content: z.string().min(1).max(20000),
    category: z.string().max(60).nullable().optional(),
  })
  .strict();

const entryUpdate = entryCreate.partial();

function pinHeader(req: FastifyRequest): string | undefined {
  const h = req.headers['x-history-pin'];
  if (typeof h === 'string') return h;
  return undefined;
}

function ipOf(req: FastifyRequest): string | undefined {
  return req.ip;
}

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'history route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function historyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/history/status', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send({ hasPin: await hasPin(req.userId!) });
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.post('/history/pin', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = setPinInput.parse(req.body);
      await setPin(req.userId!, input.pin, input.currentPin);
      return reply.code(200).send({ ok: true });
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.post('/history/verify', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = verifyInput.parse(req.body);
      await verifyPin(req.userId!, input.pin, ipOf(req));
      return reply.code(200).send({ ok: true });
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/history/entries', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await listEntries(req.userId!, pinHeader(req), ipOf(req)));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.post('/history/entries', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = entryCreate.parse(req.body);
      return reply
        .code(201)
        .send(await createEntry(req.userId!, input, pinHeader(req), ipOf(req)));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.patch<{ Params: { id: string } }>(
    '/history/entries/:id',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const input = entryUpdate.parse(req.body);
        return reply
          .code(200)
          .send(await updateEntry(req.userId!, req.params.id, input, pinHeader(req), ipOf(req)));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/history/entries/:id',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        await deleteEntry(req.userId!, req.params.id, pinHeader(req), ipOf(req));
        return reply.code(204).send();
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );
}
