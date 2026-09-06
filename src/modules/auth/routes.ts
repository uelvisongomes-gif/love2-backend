import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { registerInput } from './schema.js';
import { registerUser } from './service.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', async (req, reply) => {
    try {
      const input = registerInput.parse(req.body);
      const result = await registerUser(input);
      return reply.code(201).send(result);
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
        });
      }
      if (err instanceof AppError) {
        return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      }
      req.log.error({ err }, 'register failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });
}
