import argon2 from 'argon2';
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';

const MAX_ATTEMPTS_10MIN = 5;

async function checkRateLimit(userId: string): Promise<void> {
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const failed = await prisma.historyPinAttempt.count({
    where: { userId, success: false, createdAt: { gte: since } },
  });
  if (failed >= MAX_ATTEMPTS_10MIN) {
    throw new AppError('RATE_LIMITED', 'Muitas tentativas — espere 10 minutos', 429);
  }
}

async function logAttempt(userId: string, success: boolean, ip?: string): Promise<void> {
  await prisma.historyPinAttempt.create({ data: { userId, success, ip: ip ?? null } });
}

function normalizePin(pin: string): string {
  return pin.replace(/\D+/g, '');
}

function validatePinFormat(pin: string): string {
  const p = normalizePin(pin);
  if (p.length < 4 || p.length > 8) {
    throw new AppError('INVALID_PIN', 'PIN deve ter 4 a 8 dígitos', 400);
  }
  return p;
}

export async function hasPin(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { historyPinHash: true } });
  return Boolean(u?.historyPinHash);
}

export async function setPin(userId: string, pin: string, currentPin?: string): Promise<void> {
  const clean = validatePinFormat(pin);
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { historyPinHash: true } });
  if (u?.historyPinHash) {
    if (!currentPin) throw new AppError('CURRENT_PIN_REQUIRED', 'Informe o PIN atual', 400);
    await checkRateLimit(userId);
    const ok = await argon2.verify(u.historyPinHash, normalizePin(currentPin));
    await logAttempt(userId, ok);
    if (!ok) throw new AppError('INVALID_PIN', 'PIN atual incorreto', 401);
  }
  const hash = await argon2.hash(clean, { type: argon2.argon2id });
  await prisma.user.update({ where: { id: userId }, data: { historyPinHash: hash } });
}

export async function verifyPin(userId: string, pin: string, ip?: string): Promise<void> {
  await checkRateLimit(userId);
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { historyPinHash: true } });
  if (!u?.historyPinHash) throw new AppError('NO_PIN', 'Nenhum PIN configurado', 400);
  const ok = await argon2.verify(u.historyPinHash, normalizePin(pin));
  await logAttempt(userId, ok, ip);
  if (!ok) throw new AppError('INVALID_PIN', 'PIN incorreto', 401);
}

async function requirePin(userId: string, pin: string | undefined, ip?: string): Promise<void> {
  if (!pin) throw new AppError('PIN_REQUIRED', 'Informe o PIN', 401);
  await verifyPin(userId, pin, ip);
}

interface EntryInput {
  title: string;
  content: string;
  category?: string | null;
}

export async function listEntries(userId: string, pin: string | undefined, ip?: string) {
  await requirePin(userId, pin, ip);
  const items = await prisma.historyEntry.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  return { items };
}

export async function createEntry(
  userId: string,
  input: EntryInput,
  pin: string | undefined,
  ip?: string,
) {
  await requirePin(userId, pin, ip);
  return prisma.historyEntry.create({
    data: {
      userId,
      title: input.title,
      content: input.content,
      category: input.category ?? null,
    },
  });
}

export async function updateEntry(
  userId: string,
  id: string,
  input: Partial<EntryInput>,
  pin: string | undefined,
  ip?: string,
) {
  await requirePin(userId, pin, ip);
  const found = await prisma.historyEntry.findFirst({ where: { id, userId } });
  if (!found) throw new AppError('NOT_FOUND', 'Registro não encontrado', 404);
  return prisma.historyEntry.update({
    where: { id },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.content !== undefined && { content: input.content }),
      ...(input.category !== undefined && { category: input.category }),
    },
  });
}

export async function deleteEntry(
  userId: string,
  id: string,
  pin: string | undefined,
  ip?: string,
): Promise<void> {
  await requirePin(userId, pin, ip);
  const res = await prisma.historyEntry.deleteMany({ where: { id, userId } });
  if (res.count === 0) throw new AppError('NOT_FOUND', 'Registro não encontrado', 404);
}
