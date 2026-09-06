import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors.js';
import { computeHealth } from './service.js';

export async function healthIndexRoutes(app: FastifyInstance): Promise<void> {
  app.get('/couples/me/health', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await computeHealth(req.userId!));
    } catch (err) {
      if (err instanceof AppError) {
        return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      }
      req.log.error({ err }, 'health index failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });
}
