import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { createTaskInput, listTasksQuery } from './schema.js';
import { completeTask, createTask, deleteTask, listTasks, reopenTask } from './service.js';

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'tasks route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function tasksRoutes(app: FastifyInstance): Promise<void> {
  app.post('/tasks', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = createTaskInput.parse(req.body);
      return reply.code(201).send(await createTask(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/tasks', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const q = listTasksQuery.parse(req.query);
      return reply.code(200).send(await listTasks(req.userId!, q));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.post<{ Params: { id: string } }>(
    '/tasks/:id/complete',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(200).send(await completeTask(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/tasks/:id/reopen',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(200).send(await reopenTask(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/tasks/:id',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        await deleteTask(req.userId!, req.params.id);
        return reply.code(204).send();
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );
}
