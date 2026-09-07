import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import {
  confirmPasswordResetInput,
  loginInput,
  registerInput,
  requestPasswordResetInput,
  verify2faInput,
} from './schema.js';
import {
  confirmPasswordReset,
  loginUser,
  registerUser,
  request2fa,
  requestPasswordReset,
  verify2fa,
} from './service.js';

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

  app.post('/auth/password-reset/request', async (req, reply) => {
    try {
      const input = requestPasswordResetInput.parse(req.body);
      const result = await requestPasswordReset(input.email);
      return reply.code(200).send(result);
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
        });
      }
      req.log.error({ err }, 'password reset request failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });

  app.post('/auth/password-reset/confirm', async (req, reply) => {
    try {
      const input = confirmPasswordResetInput.parse(req.body);
      const result = await confirmPasswordReset(input);
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
      req.log.error({ err }, 'password reset confirm failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });

  app.post('/auth/2fa/request', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await request2fa(req.userId!));
    } catch (err) {
      if (err instanceof AppError) {
        return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      }
      req.log.error({ err }, '2fa request failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });

  app.post('/auth/2fa/verify', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = verify2faInput.parse(req.body);
      return reply.code(200).send(await verify2fa(req.userId!, input));
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
        });
      }
      if (err instanceof AppError) {
        return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      }
      req.log.error({ err }, '2fa verify failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });
}
