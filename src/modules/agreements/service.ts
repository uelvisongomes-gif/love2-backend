import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import type { AgreementStatus, CreateAgreementInput, UpdateAgreementInput } from './schema.js';

async function coupleIdOf(userId: string): Promise<string | null> {
  const c = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true },
  });
  return c?.id ?? null;
}

export async function createAgreement(userId: string, input: CreateAgreementInput) {
  const coupleId = await coupleIdOf(userId);
  return prisma.agreement.create({
    data: {
      coupleId,
      createdBy: userId,
      title: input.title,
      content: input.content,
      pillar: input.pillar,
      conflictId: input.conflictId,
    },
  });
}

export async function listAgreements(userId: string) {
  const coupleId = await coupleIdOf(userId);
  // Se tem casal, vê todos do casal (compartilhado).
  // Se não tem, só vê os próprios.
  const where = coupleId
    ? { OR: [{ coupleId }, { createdBy: userId }] }
    : { createdBy: userId };
  const agreements = await prisma.agreement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
  return { agreements };
}

async function assertOwnershipOrCouple(userId: string, id: string): Promise<void> {
  const coupleId = await coupleIdOf(userId);
  const found = await prisma.agreement.findFirst({
    where: {
      id,
      OR: [
        { createdBy: userId },
        ...(coupleId ? [{ coupleId }] : []),
      ],
    },
    select: { id: true },
  });
  if (!found) throw new AppError('NOT_FOUND', 'Acordo não encontrado', 404);
}

export async function updateAgreement(userId: string, id: string, input: UpdateAgreementInput) {
  await assertOwnershipOrCouple(userId, id);
  return prisma.agreement.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.pillar !== undefined ? { pillar: input.pillar } : {}),
    },
  });
}

export async function setAgreementStatus(userId: string, id: string, status: AgreementStatus) {
  await assertOwnershipOrCouple(userId, id);
  return prisma.agreement.update({
    where: { id },
    data: {
      status,
      resolvedAt: status === 'cumprido' ? new Date() : null,
    },
  });
}

export async function deleteAgreement(userId: string, id: string): Promise<void> {
  await assertOwnershipOrCouple(userId, id);
  await prisma.agreement.delete({ where: { id } });
}
