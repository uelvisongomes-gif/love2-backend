import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import {
  createAgreementInput,
  setStatusInput,
  updateAgreementInput,
} from './schema.js';
import {
  createAgreement,
  deleteAgreement,
  listAgreements,
  setAgreementStatus,
  updateAgreement,
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
  log.error({ err }, 'agreements route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function agreementsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/agreements', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = createAgreementInput.parse(req.body);
      return reply.code(201).send(await createAgreement(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/agreements', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await listAgreements(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.patch<{ Params: { id: string } }>(
    '/agreements/:id',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const input = updateAgreementInput.parse(req.body);
        return reply.code(200).send(await updateAgreement(req.userId!, req.params.id, input));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/agreements/:id/status',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const input = setStatusInput.parse(req.body);
        return reply
          .code(200)
          .send(await setAgreementStatus(req.userId!, req.params.id, input.status));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/agreements/:id',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        await deleteAgreement(req.userId!, req.params.id);
        return reply.code(204).send();
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );
}
