import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { consentInput } from './schema.js';
import { consentStatus, grantConsent } from './service.js';

export async function consentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/consent', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = consentInput.parse(req.body);
      return reply.code(201).send(await grantConsent(req.userId!, input));
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
        });
      }
      if (err instanceof AppError) {
        return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      }
      req.log.error({ err }, 'consent grant failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });

  app.get('/consent/status', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await consentStatus(req.userId!));
    } catch (err) {
      req.log.error({ err }, 'consent status failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });
}
