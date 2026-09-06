import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import type { CreateTaskInput } from './schema.js';

async function coupleOf(userId: string): Promise<{ id: string; userAId: string; userBId: string }> {
  const c = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true, userAId: true, userBId: true },
  });
  if (!c) throw new AppError('NO_COUPLE', 'Você ainda não está vinculado a um casal', 403);
  return c;
}

export async function createTask(userId: string, input: CreateTaskInput) {
  const couple = await coupleOf(userId);
  return prisma.coupleTask.create({
    data: {
      coupleId: couple.id,
      pillar: input.pillar,
      title: input.title,
      description: input.description,
      dueBy: input.dueBy ? new Date(input.dueBy) : null,
      createdBy: userId,
    },
  });
}

export async function listTasks(userId: string) {
  const couple = await coupleOf(userId);
  const tasks = await prisma.coupleTask.findMany({
    where: { coupleId: couple.id },
    orderBy: { createdAt: 'desc' },
  });
  return { tasks };
}

export async function completeTask(userId: string, id: string) {
  const couple = await coupleOf(userId);
  const task = await prisma.coupleTask.findFirst({ where: { id, coupleId: couple.id } });
  if (!task) throw new AppError('NOT_FOUND', 'Tarefa não encontrada', 404);
  const patch = userId === couple.userAId ? { completedByA: true } : { completedByB: true };
  const updated = await prisma.coupleTask.update({
    where: { id },
    data: patch,
  });
  if (updated.completedByA && updated.completedByB && !updated.completedAt) {
    return prisma.coupleTask.update({ where: { id }, data: { completedAt: new Date() } });
  }
  return updated;
}

export async function deleteTask(userId: string, id: string): Promise<void> {
  const couple = await coupleOf(userId);
  const res = await prisma.coupleTask.deleteMany({ where: { id, coupleId: couple.id } });
  if (res.count === 0) throw new AppError('NOT_FOUND', 'Tarefa não encontrada', 404);
}
