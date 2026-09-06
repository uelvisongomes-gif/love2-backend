import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { loginInput, registerInput } from './schema.js';
import { loginUser, registerUser } from './service.js';

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

  app.post('/auth/login', async (req, reply) => {
    try {
      const input = loginInput.parse(req.body);
      const result = await loginUser(input);
      return reply.code(200).send(result);
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
        });
      }
      if (err instanceof AppError) {
        return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      }
      req.log.error({ err }, 'login failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });
}
