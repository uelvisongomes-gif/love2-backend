import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { getEvolution } from './service.js';

const query = z.object({ days: z.coerce.number().int().min(7).max(180).default(30) }).strict();

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'evolution route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function evolutionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/evolution', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const { days } = query.parse(req.query);
      return reply.code(200).send(await getEvolution(req.userId!, days));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
