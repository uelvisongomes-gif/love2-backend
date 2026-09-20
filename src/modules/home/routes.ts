import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { AppError } from '../../errors.js';
import { getHomeSummary } from './service.js';

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'home route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function homeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/home/summary', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getHomeSummary(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
