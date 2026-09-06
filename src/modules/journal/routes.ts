import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { createEntryInput, listQuery, updateEntryInput } from './schema.js';
import { createEntry, deleteEntry, getEntry, listEntries, updateEntry } from './service.js';

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'journal route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function journalRoutes(app: FastifyInstance): Promise<void> {
  app.post('/journal', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = createEntryInput.parse(req.body);
      return reply.code(201).send(await createEntry(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/journal', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const q = listQuery.parse(req.query ?? {});
      return reply.code(200).send(await listEntries(req.userId!, q));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get<{ Params: { id: string } }>('/journal/:id', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getEntry(req.userId!, req.params.id));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.patch<{ Params: { id: string } }>('/journal/:id', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = updateEntryInput.parse(req.body);
      return reply.code(200).send(await updateEntry(req.userId!, req.params.id, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.delete<{ Params: { id: string } }>('/journal/:id', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      await deleteEntry(req.userId!, req.params.id);
      return reply.code(204).send();
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
