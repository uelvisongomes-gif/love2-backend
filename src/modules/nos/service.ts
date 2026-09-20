import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';

async function coupleOf(userId: string): Promise<{ id: string; userAId: string; userBId: string } | null> {
  return prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true, userAId: true, userBId: true },
  });
}

interface NarrativeInput {
  ourVision?: string | null;
  ourHistory?: string | null;
  ourValues?: string | null;
  connectionRituals?: string | null;
}

export async function getNarrative(userId: string) {
  const couple = await coupleOf(userId);
  if (!couple) return null;
  return prisma.coupleNarrative.findUnique({ where: { coupleId: couple.id } });
}

export async function upsertNarrative(userId: string, input: NarrativeInput) {
  const couple = await coupleOf(userId);
  if (!couple) throw new AppError('NO_COUPLE', 'Vincule seu parceiro primeiro', 400);
  return prisma.coupleNarrative.upsert({
    where: { coupleId: couple.id },
    create: {
      coupleId: couple.id,
      updatedById: userId,
      ourVision: input.ourVision ?? null,
      ourHistory: input.ourHistory ?? null,
      ourValues: input.ourValues ?? null,
      connectionRituals: input.connectionRituals ?? null,
    },
    update: {
      updatedById: userId,
      ...(input.ourVision !== undefined && { ourVision: input.ourVision }),
      ...(input.ourHistory !== undefined && { ourHistory: input.ourHistory }),
      ...(input.ourValues !== undefined && { ourValues: input.ourValues }),
      ...(input.connectionRituals !== undefined && { connectionRituals: input.connectionRituals }),
    },
  });
}

interface PerceptionInput {
  admiration?: string | null;
  gratitude?: string | null;
  worries?: string | null;
  hopes?: string | null;
  visibleToPartner?: boolean;
}

export async function getMyPerception(userId: string) {
  return prisma.partnerPerception.findUnique({ where: { userId } });
}

export async function upsertMyPerception(userId: string, input: PerceptionInput) {
  return prisma.partnerPerception.upsert({
    where: { userId },
    create: {
      userId,
      admiration: input.admiration ?? null,
      gratitude: input.gratitude ?? null,
      worries: input.worries ?? null,
      hopes: input.hopes ?? null,
      visibleToPartner: input.visibleToPartner ?? false,
    },
    update: {
      ...(input.admiration !== undefined && { admiration: input.admiration }),
      ...(input.gratitude !== undefined && { gratitude: input.gratitude }),
      ...(input.worries !== undefined && { worries: input.worries }),
      ...(input.hopes !== undefined && { hopes: input.hopes }),
      ...(input.visibleToPartner !== undefined && { visibleToPartner: input.visibleToPartner }),
    },
  });
}

// Só os campos visibleToPartner são retornados
export async function getPartnerPerception(userId: string) {
  const couple = await coupleOf(userId);
  if (!couple) return null;
  const partnerId = couple.userAId === userId ? couple.userBId : couple.userAId;
  const p = await prisma.partnerPerception.findUnique({ where: { userId: partnerId } });
  if (!p || !p.visibleToPartner) return null;
  return {
    admiration: p.admiration,
    gratitude: p.gratitude,
    worries: p.worries,
    hopes: p.hopes,
    updatedAt: p.updatedAt,
  };
}

// Challenges — CRUD
interface ChallengeInput {
  title: string;
  description?: string | null;
  visibleToPartner?: boolean;
}

export async function listMyChallenges(userId: string) {
  const items = await prisma.personalChallenge.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  return { items };
}

export async function createChallenge(userId: string, input: ChallengeInput) {
  return prisma.personalChallenge.create({
    data: {
      userId,
      title: input.title,
      description: input.description ?? null,
      visibleToPartner: input.visibleToPartner ?? false,
    },
  });
}

export async function updateChallenge(userId: string, id: string, input: Partial<ChallengeInput>) {
  const found = await prisma.personalChallenge.findFirst({ where: { id, userId } });
  if (!found) throw new AppError('NOT_FOUND', 'Desafio não encontrado', 404);
  return prisma.personalChallenge.update({
    where: { id },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.visibleToPartner !== undefined && { visibleToPartner: input.visibleToPartner }),
    },
  });
}

export async function deleteChallenge(userId: string, id: string): Promise<void> {
  const res = await prisma.personalChallenge.deleteMany({ where: { id, userId } });
  if (res.count === 0) throw new AppError('NOT_FOUND', 'Desafio não encontrado', 404);
}

// Desafios do parceiro (só os visíveis)
export async function listPartnerVisibleChallenges(userId: string) {
  const couple = await coupleOf(userId);
  if (!couple) return { items: [] };
  const partnerId = couple.userAId === userId ? couple.userBId : couple.userAId;
  const items = await prisma.personalChallenge.findMany({
    where: { userId: partnerId, visibleToPartner: true },
    orderBy: { createdAt: 'desc' },
  });
  return { items };
}
