import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import type { CreateChildInput, UpdateChildInput } from './schema.js';

async function coupleOf(userId: string): Promise<{ id: string } | null> {
  return prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true },
  });
}

function ownership(userId: string, couple: { id: string } | null) {
  return couple
    ? [{ coupleId: couple.id }, { coupleId: null, createdBy: userId }]
    : [{ coupleId: null, createdBy: userId }];
}

function normalize(input: CreateChildInput | UpdateChildInput): Record<string, unknown> {
  const data: Record<string, unknown> = { ...input };
  if (input.birthDate !== undefined) {
    data.birthDate = input.birthDate ? new Date(input.birthDate) : null;
  }
  return data;
}

export async function createChild(userId: string, input: CreateChildInput) {
  const couple = await coupleOf(userId);
  return prisma.child.create({
    data: {
      coupleId: couple?.id ?? null,
      createdBy: userId,
      name: input.name,
      ...normalize(input),
    },
  });
}

export async function listChildren(userId: string) {
  const couple = await coupleOf(userId);
  const items = await prisma.child.findMany({
    where: { OR: ownership(userId, couple) },
    orderBy: [{ birthDate: 'asc' }, { createdAt: 'asc' }],
  });
  return { items };
}

export async function updateChild(userId: string, id: string, input: UpdateChildInput) {
  const couple = await coupleOf(userId);
  const found = await prisma.child.findFirst({ where: { id, OR: ownership(userId, couple) } });
  if (!found) throw new AppError('NOT_FOUND', 'Filho não encontrado', 404);
  return prisma.child.update({ where: { id }, data: normalize(input) });
}

export async function deleteChild(userId: string, id: string): Promise<void> {
  const couple = await coupleOf(userId);
  const res = await prisma.child.deleteMany({ where: { id, OR: ownership(userId, couple) } });
  if (res.count === 0) throw new AppError('NOT_FOUND', 'Filho não encontrado', 404);
}
