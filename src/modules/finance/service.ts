import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import type { CreateFinanceInput, ListFinanceQuery, UpdateFinanceInput } from './schema.js';

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

export async function createFinance(userId: string, input: CreateFinanceInput) {
  const couple = await coupleOfOptional(userId);
  return prisma.financeItem.create({
    data: {
      coupleId: couple?.id ?? null,
      createdBy: userId,
      kind: input.kind,
      title: input.title,
      amount: input.amount,
      category: input.category,
      dueBy: input.dueBy ? new Date(input.dueBy) : null,
      responsibleId: resolveResponsible(input.assignTo, userId, couple),
      recurring: input.recurring,
      notes: input.notes,
    },
  });
}

export async function listFinance(userId: string, query: ListFinanceQuery) {
  const couple = await coupleOfOptional(userId);
  const where: Record<string, unknown> = { OR: ownershipWhere(userId, couple) };
  if (query.kind) where.kind = query.kind;
  if (query.status === 'open') where.paidAt = null;
  else if (query.status === 'paid') where.paidAt = { not: null };
  const items = await prisma.financeItem.findMany({
    where,
    orderBy: [{ paidAt: 'asc' }, { dueBy: 'asc' }, { createdAt: 'desc' }],
  });
  return { items };
}

export async function updateFinance(userId: string, id: string, input: UpdateFinanceInput) {
  const couple = await coupleOfOptional(userId);
  const found = await prisma.financeItem.findFirst({
    where: { id, OR: ownershipWhere(userId, couple) },
  });
  if (!found) throw new AppError('NOT_FOUND', 'Item não encontrado', 404);
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.amount !== undefined) data.amount = input.amount;
  if (input.category !== undefined) data.category = input.category;
  if (input.dueBy !== undefined) data.dueBy = input.dueBy ? new Date(input.dueBy) : null;
  if (input.recurring !== undefined) data.recurring = input.recurring;
  if (input.notes !== undefined) data.notes = input.notes;
  if (input.assignTo) data.responsibleId = resolveResponsible(input.assignTo, userId, couple);
  return prisma.financeItem.update({ where: { id }, data });
}

export async function togglePaid(userId: string, id: string) {
  const couple = await coupleOfOptional(userId);
  const found = await prisma.financeItem.findFirst({
    where: { id, OR: ownershipWhere(userId, couple) },
  });
  if (!found) throw new AppError('NOT_FOUND', 'Item não encontrado', 404);
  const patch = found.paidAt ? { paidAt: null } : { paidAt: new Date() };
  return prisma.financeItem.update({ where: { id }, data: patch });
}

export async function deleteFinance(userId: string, id: string): Promise<void> {
  const couple = await coupleOfOptional(userId);
  const res = await prisma.financeItem.deleteMany({
    where: { id, OR: ownershipWhere(userId, couple) },
  });
  if (res.count === 0) throw new AppError('NOT_FOUND', 'Item não encontrado', 404);
}
