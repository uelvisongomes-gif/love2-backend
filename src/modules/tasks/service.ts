import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import type { CreateTaskInput, ListTasksQuery, UpdateTaskInput } from './schema.js';

async function coupleOfOptional(
  userId: string,
): Promise<{ id: string; userAId: string; userBId: string } | null> {
  return prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true, userAId: true, userBId: true },
  });
}

async function coupleOf(userId: string): Promise<{ id: string; userAId: string; userBId: string }> {
  const c = await coupleOfOptional(userId);
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
  const couple = await coupleOfOptional(userId);
  const assignedTo = couple ? resolveAssignedTo(input.assignTo, userId, couple) : userId;
  return prisma.coupleTask.create({
    data: {
      coupleId: couple?.id ?? null,
      pillar: input.pillar,
      title: input.title,
      description: input.description,
      dueBy: input.dueBy ? new Date(input.dueBy) : null,
      category: input.category,
      assignedTo,
      recurrence: input.recurrence,
      remindAt: input.remindAt ? new Date(input.remindAt) : null,
      createdBy: userId,
    },
  });
}

function nextDueDate(base: Date | null, recurrence: string): Date {
  const start = base ?? new Date();
  const next = new Date(start);
  if (recurrence === 'daily') next.setDate(next.getDate() + 1);
  else if (recurrence === 'weekly') next.setDate(next.getDate() + 7);
  else if (recurrence === 'monthly') next.setMonth(next.getMonth() + 1);
  return next;
}

export async function listTasks(userId: string, query: ListTasksQuery = { scope: 'all', status: 'open' }) {
  const couple = await coupleOfOptional(userId);
  const partnerId = couple ? (couple.userAId === userId ? couple.userBId : couple.userAId) : null;

  // Solo: só as próprias (coupleId null + createdBy = user)
  // Casal: todas do casal
  const base: Record<string, unknown> = couple
    ? { OR: [{ coupleId: couple.id }, { coupleId: null, createdBy: userId }] }
    : { coupleId: null, createdBy: userId };

  const where: Record<string, unknown> = { ...base };
  if (query.category) where.category = query.category;
  if (query.scope === 'mine') {
    where.AND = [{ OR: [{ assignedTo: userId }, { assignedTo: null }] }];
  } else if (query.scope === 'partner' && partnerId) {
    where.AND = [{ OR: [{ assignedTo: partnerId }, { assignedTo: null }] }];
  }
  if (query.status === 'open') where.completedAt = null;
  else if (query.status === 'done') where.completedAt = { not: null };

  const tasks = await prisma.coupleTask.findMany({
    where,
    orderBy: [{ completedAt: 'asc' }, { dueBy: 'asc' }, { createdAt: 'desc' }],
  });
  return { tasks };
}

async function applyCompletion(id: string, hasRecurrence: string | null, current: {
  dueBy: Date | null;
  completedByA: boolean;
  completedByB: boolean;
}) {
  if (hasRecurrence) {
    // Recorrente: rola a data pra próxima ocorrência e mantém aberta
    const nextDue = nextDueDate(current.dueBy, hasRecurrence);
    return prisma.coupleTask.update({
      where: { id },
      data: {
        completedAt: null,
        completedByA: false,
        completedByB: false,
        dueBy: nextDue,
      },
    });
  }
  return prisma.coupleTask.update({ where: { id }, data: { completedAt: new Date() } });
}

export async function completeTask(userId: string, id: string) {
  const couple = await coupleOfOptional(userId);
  const task = await prisma.coupleTask.findFirst({
    where: {
      id,
      OR: couple
        ? [{ coupleId: couple.id }, { coupleId: null, createdBy: userId }]
        : [{ coupleId: null, createdBy: userId }],
    },
  });
  if (!task) throw new AppError('NOT_FOUND', 'Tarefa não encontrada', 404);

  // Tarefa solo (sem casal): quem criou marca direto
  if (!couple) {
    return applyCompletion(id, task.recurrence ?? null, {
      dueBy: task.dueBy,
      completedByA: task.completedByA,
      completedByB: task.completedByB,
    });
  }

  // Se assignedTo é definido (não null = both), quem foi atribuído marca como cumprido direto
  if (task.assignedTo && task.assignedTo === userId) {
    if (task.recurrence) {
      return applyCompletion(id, task.recurrence, {
        dueBy: task.dueBy,
        completedByA: task.completedByA,
        completedByB: task.completedByB,
      });
    }
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
    return applyCompletion(id, task.recurrence ?? null, {
      dueBy: updated.dueBy,
      completedByA: updated.completedByA,
      completedByB: updated.completedByB,
    });
  }
  return updated;
}

export async function updateTask(userId: string, id: string, input: UpdateTaskInput) {
  const couple = await coupleOfOptional(userId);
  const task = await prisma.coupleTask.findFirst({
    where: {
      id,
      OR: couple
        ? [{ coupleId: couple.id }, { coupleId: null, createdBy: userId }]
        : [{ coupleId: null, createdBy: userId }],
    },
  });
  if (!task) throw new AppError('NOT_FOUND', 'Tarefa não encontrada', 404);

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.category !== undefined) data.category = input.category;
  if (input.recurrence !== undefined) data.recurrence = input.recurrence;
  if (input.dueBy !== undefined) data.dueBy = input.dueBy ? new Date(input.dueBy) : null;
  if (input.remindAt !== undefined) {
    data.remindAt = input.remindAt ? new Date(input.remindAt) : null;
    // Se muda o horário, limpa log pra permitir novo envio
    await prisma.taskReminderLog.deleteMany({ where: { taskId: id } });
  }
  if (input.assignTo) {
    if (couple) {
      data.assignedTo = resolveAssignedTo(input.assignTo, userId, couple);
    } else {
      data.assignedTo = userId;
    }
  }

  return prisma.coupleTask.update({ where: { id }, data });
}

export async function reopenTask(userId: string, id: string) {
  const couple = await coupleOfOptional(userId);
  const task = await prisma.coupleTask.findFirst({
    where: {
      id,
      OR: couple
        ? [{ coupleId: couple.id }, { coupleId: null, createdBy: userId }]
        : [{ coupleId: null, createdBy: userId }],
    },
  });
  if (!task) throw new AppError('NOT_FOUND', 'Tarefa não encontrada', 404);
  return prisma.coupleTask.update({
    where: { id },
    data: { completedAt: null, completedByA: false, completedByB: false },
  });
}

export async function deleteTask(userId: string, id: string): Promise<void> {
  const couple = await coupleOfOptional(userId);
  const res = await prisma.coupleTask.deleteMany({
    where: {
      id,
      OR: couple
        ? [{ coupleId: couple.id }, { coupleId: null, createdBy: userId }]
        : [{ coupleId: null, createdBy: userId }],
    },
  });
  if (res.count === 0) throw new AppError('NOT_FOUND', 'Tarefa não encontrada', 404);
}
