import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import type { CreateLifeInput, ListLifeQuery, UpdateLifeInput } from './schema.js';

async function coupleOfOptional(userId: string) {
  return prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true, userAId: true, userBId: true },
  });
}

function resolveResponsible(
  assignTo: 'me' | 'partner' | 'both',
  userId: string,
  couple: { userAId: string; userBId: string } | null,
): string | null {
  if (!couple) return userId;
  if (assignTo === 'both') return null;
  const partnerId = couple.userAId === userId ? couple.userBId : couple.userAId;
  return assignTo === 'me' ? userId : partnerId;
}

function ownershipWhere(userId: string, couple: { id: string } | null) {
  return couple
    ? [{ coupleId: couple.id }, { coupleId: null, createdBy: userId }]
    : [{ coupleId: null, createdBy: userId }];
}

export async function createLife(userId: string, input: CreateLifeInput) {
  const couple = await coupleOfOptional(userId);
  return prisma.lifeItem.create({
    data: {
      coupleId: couple?.id ?? null,
      createdBy: userId,
      domain: input.domain,
      title: input.title,
      description: input.description,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      responsibleId: resolveResponsible(input.assignTo, userId, couple),
      recurring: input.recurring,
    },
  });
}

export async function listLife(userId: string, query: ListLifeQuery) {
  const couple = await coupleOfOptional(userId);
  const where: Record<string, unknown> = { OR: ownershipWhere(userId, couple), domain: query.domain };
  if (query.status === 'open') where.completedAt = null;
  else if (query.status === 'done') where.completedAt = { not: null };
  const items = await prisma.lifeItem.findMany({
    where,
    orderBy: [{ completedAt: 'asc' }, { scheduledAt: 'asc' }, { createdAt: 'desc' }],
  });
  return { items };
}

export async function updateLife(userId: string, id: string, input: UpdateLifeInput) {
  const couple = await coupleOfOptional(userId);
  const found = await prisma.lifeItem.findFirst({
    where: { id, OR: ownershipWhere(userId, couple) },
  });
  if (!found) throw new AppError('NOT_FOUND', 'Item não encontrado', 404);
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.scheduledAt !== undefined) data.scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
  if (input.recurring !== undefined) data.recurring = input.recurring;
  if (input.assignTo) data.responsibleId = resolveResponsible(input.assignTo, userId, couple);
  return prisma.lifeItem.update({ where: { id }, data });
}

export async function toggleDone(userId: string, id: string) {
  const couple = await coupleOfOptional(userId);
  const found = await prisma.lifeItem.findFirst({
    where: { id, OR: ownershipWhere(userId, couple) },
  });
  if (!found) throw new AppError('NOT_FOUND', 'Item não encontrado', 404);
  const patch = found.completedAt ? { completedAt: null } : { completedAt: new Date() };
  return prisma.lifeItem.update({ where: { id }, data: patch });
}

export async function deleteLife(userId: string, id: string): Promise<void> {
  const couple = await coupleOfOptional(userId);
  const res = await prisma.lifeItem.deleteMany({
    where: { id, OR: ownershipWhere(userId, couple) },
  });
  if (res.count === 0) throw new AppError('NOT_FOUND', 'Item não encontrado', 404);
}
