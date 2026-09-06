import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { chatWithLove } from '../../ai/orchestrator.js';
import { CURRENT_CONSENT_VERSIONS } from '../consent/service.js';
import type { ConflictMessageInput, ConflictStatus, CreateConflictInput } from './schema.js';

async function assertLoveConsent(userId: string): Promise<void> {
  const required = CURRENT_CONSENT_VERSIONS.disclaimer_love_not_therapist;
  const hit = await prisma.consent.findFirst({
    where: { userId, scope: 'disclaimer_love_not_therapist', version: required },
  });
  if (!hit) throw new AppError('CONSENT_REQUIRED', 'Aceite o disclaimer da LOVE para usar', 403);
}

async function coupleOf(userId: string) {
  const c = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true, userAId: true, userBId: true },
  });
  if (!c) throw new AppError('NO_COUPLE', 'Você ainda não está vinculado a um casal', 403);
  return c;
}

function sideOf(userId: string, initiatorId: string): 'A' | 'B' {
  return userId === initiatorId ? 'A' : 'B';
}

function canPost(status: ConflictStatus, side: 'A' | 'B'): boolean {
  if (side === 'A') return status === 'collecting_a' || status === 'cross_referenced';
  return status === 'collecting_b';
}

export async function createConflict(userId: string, input: CreateConflictInput) {
  await assertLoveConsent(userId);
  const couple = await coupleOf(userId);
  const targetId = couple.userAId === userId ? couple.userBId : couple.userAId;
  const conflict = await prisma.conflict.create({
    data: {
      coupleId: couple.id,
      initiatorId: userId,
      targetId,
      status: 'collecting_a',
      pillar: input.pillar,
      title: input.title,
    },
  });
  await prisma.conflictMessage.create({
    data: {
      conflictId: conflict.id,
      side: 'A',
      authorId: userId,
      role: 'user',
      content: input.initialContent,
    },
  });
  const reply = await chatWithLove({
    userId,
    content: input.initialContent,
    context: 'conflict',
  });
  await prisma.conflictMessage.create({
    data: {
      conflictId: conflict.id,
      side: 'A',
      authorId: userId,
      role: 'assistant',
      content: reply.reply,
    },
  });
  return conflict;
}

export async function postMessage(userId: string, conflictId: string, input: ConflictMessageInput) {
  await assertLoveConsent(userId);
  const conflict = await prisma.conflict.findUnique({ where: { id: conflictId } });
  if (!conflict) throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  await coupleOf(userId);
  if (conflict.initiatorId !== userId && conflict.targetId !== userId) {
    throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  }
  const side = sideOf(userId, conflict.initiatorId);
  if (!canPost(conflict.status as ConflictStatus, side)) {
    throw new AppError('WRONG_SIDE', 'Não é sua vez nesta etapa do conflito', 403);
  }
  await prisma.conflictMessage.create({
    data: { conflictId, side, authorId: userId, role: 'user', content: input.content },
  });
  const reply = await chatWithLove({ userId, content: input.content, context: 'conflict' });
  return prisma.conflictMessage.create({
    data: { conflictId, side, authorId: userId, role: 'assistant', content: reply.reply },
  });
}

export async function getConflict(userId: string, conflictId: string) {
  const conflict = await prisma.conflict.findUnique({ where: { id: conflictId } });
  if (!conflict) throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  if (conflict.initiatorId !== userId && conflict.targetId !== userId) {
    throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  }
  const side = sideOf(userId, conflict.initiatorId);
  const messages = await prisma.conflictMessage.findMany({
    where: { conflictId, side },
    orderBy: { createdAt: 'asc' },
    select: { id: true, side: true, role: true, content: true, createdAt: true },
  });
  return {
    id: conflict.id,
    status: conflict.status,
    pillar: conflict.pillar,
    title: conflict.title,
    createdAt: conflict.createdAt,
    updatedAt: conflict.updatedAt,
    mySide: side,
    messages,
  };
}

export async function listConflicts(userId: string) {
  const conflicts = await prisma.conflict.findMany({
    where: { OR: [{ initiatorId: userId }, { targetId: userId }] },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      pillar: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      initiatorId: true,
    },
  });
  return {
    conflicts: conflicts.map((c) => ({
      id: c.id,
      status: c.status,
      pillar: c.pillar,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      role: c.initiatorId === userId ? 'A' : 'B',
    })),
  };
}
