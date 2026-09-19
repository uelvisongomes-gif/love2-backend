import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import type { CreateTaskInput, ListTasksQuery } from './schema.js';

async function coupleOf(userId: string): Promise<{ id: string; userAId: string; userBId: string }> {
  const c = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true, userAId: true, userBId: true },
  });
  if (!c) throw new AppError('NO_COUPLE', 'Você ainda não está vinculado a um casal', 403);
  return c;
}

function resolveAssignedTo(
  assignTo: 'me' | 'partner' | 'both',
  userId: string,
  couple: { userAId: string; userBId: string },
): string | null {
  if (assignTo === 'both') return null;
  const partnerId = couple.userAId === userId ? couple.userBId : couple.userAId;
  return assignTo === 'me' ? userId : partnerId;
}

export async function createTask(userId: string, input: CreateTaskInput) {
  const couple = await coupleOf(userId);
  const assignedTo = resolveAssignedTo(input.assignTo, userId, couple);
  return prisma.coupleTask.create({
    data: {
      coupleId: couple.id,
      pillar: input.pillar,
      title: input.title,
      description: input.description,
      dueBy: input.dueBy ? new Date(input.dueBy) : null,
      category: input.category,
      assignedTo,
      createdBy: userId,
    },
  });
}

export async function listTasks(userId: string, query: ListTasksQuery = { scope: 'all', status: 'open' }) {
  const couple = await coupleOf(userId);
  const partnerId = couple.userAId === userId ? couple.userBId : couple.userAId;

  const where: Record<string, unknown> = { coupleId: couple.id };
  if (query.category) where.category = query.category;
  if (query.scope === 'mine') {
    where.OR = [{ assignedTo: userId }, { assignedTo: null }];
  } else if (query.scope === 'partner') {
    where.OR = [{ assignedTo: partnerId }, { assignedTo: null }];
  }
  if (query.status === 'open') where.completedAt = null;
  else if (query.status === 'done') where.completedAt = { not: null };

  const tasks = await prisma.coupleTask.findMany({
    where,
    orderBy: [{ completedAt: 'asc' }, { dueBy: 'asc' }, { createdAt: 'desc' }],
  });
  return { tasks };
}

export async function completeTask(userId: string, id: string) {
  const couple = await coupleOf(userId);
  const task = await prisma.coupleTask.findFirst({ where: { id, coupleId: couple.id } });
  if (!task) throw new AppError('NOT_FOUND', 'Tarefa não encontrada', 404);

  // Se assignedTo é definido (não null = both), quem foi atribuído marca como cumprido direto
  if (task.assignedTo && task.assignedTo === userId) {
    return prisma.coupleTask.update({
      where: { id },
      data: {
        completedAt: new Date(),
        completedByA: userId === couple.userAId ? true : task.completedByA,
        completedByB: userId === couple.userBId ? true : task.completedByB,
      },
    });
  }
  // Se atribuído ao parceiro e não a você, você não pode marcar cumprido
  if (task.assignedTo && task.assignedTo !== userId) {
    throw new AppError('FORBIDDEN', 'Essa tarefa é do seu parceiro', 403);
  }
  // Se ambos (assignedTo null), precisa dos dois pra fechar
  const patch = userId === couple.userAId ? { completedByA: true } : { completedByB: true };
  const updated = await prisma.coupleTask.update({ where: { id }, data: patch });
  if (updated.completedByA && updated.completedByB && !updated.completedAt) {
    return prisma.coupleTask.update({ where: { id }, data: { completedAt: new Date() } });
  }
  return updated;
}

export async function reopenTask(userId: string, id: string) {
  const couple = await coupleOf(userId);
  const task = await prisma.coupleTask.findFirst({ where: { id, coupleId: couple.id } });
  if (!task) throw new AppError('NOT_FOUND', 'Tarefa não encontrada', 404);
  return prisma.coupleTask.update({
    where: { id },
    data: { completedAt: null, completedByA: false, completedByB: false },
  });
}

export async function deleteTask(userId: string, id: string): Promise<void> {
  const couple = await coupleOf(userId);
  const res = await prisma.coupleTask.deleteMany({ where: { id, coupleId: couple.id } });
  if (res.count === 0) throw new AppError('NOT_FOUND', 'Tarefa não encontrada', 404);
}
