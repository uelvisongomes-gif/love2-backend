import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from './tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async (app) => {
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Sem token' } });
    }
    try {
      const { sub } = verifyAccessToken(auth.slice(7));
      req.userId = sub;
    } catch {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Token inválido' } });
    }
  });
});
