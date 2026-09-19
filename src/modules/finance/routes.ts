import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { createFinanceInput, listFinanceQuery, updateFinanceInput } from './schema.js';
import {
  createFinance,
  deleteFinance,
  listFinance,
  togglePaid,
  updateFinance,
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
  log.error({ err }, 'finance route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function financeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/finance', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = createFinanceInput.parse(req.body);
      return reply.code(201).send(await createFinance(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/finance', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const q = listFinanceQuery.parse(req.query);
      return reply.code(200).send(await listFinance(req.userId!, q));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.patch<{ Params: { id: string } }>(
    '/finance/:id',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const input = updateFinanceInput.parse(req.body);
        return reply.code(200).send(await updateFinance(req.userId!, req.params.id, input));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/finance/:id/toggle-paid',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(200).send(await togglePaid(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/finance/:id',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        await deleteFinance(req.userId!, req.params.id);
        return reply.code(204).send();
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );
}
