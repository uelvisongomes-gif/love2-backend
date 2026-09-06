import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import type { CreateEntryInput, UpdateEntryInput } from './schema.js';

export async function createEntry(userId: string, input: CreateEntryInput) {
  return prisma.journalEntry.create({ data: { userId, ...input } });
}

export async function listEntries(
  userId: string,
  opts: { limit: number; cursor?: string },
): Promise<{
  entries: { id: string; title: string; mood: number | null; createdAt: Date }[];
  nextCursor: string | null;
}> {
  const rows = await prisma.journalEntry.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: { id: true, title: true, mood: true, createdAt: true },
  });
  const hasMore = rows.length > opts.limit;
  const entries = hasMore ? rows.slice(0, opts.limit) : rows;
  return { entries, nextCursor: hasMore ? entries[entries.length - 1].id : null };
}

export async function getEntry(userId: string, id: string) {
  const e = await prisma.journalEntry.findFirst({ where: { id, userId } });
  if (!e) throw new AppError('NOT_FOUND', 'Entrada não encontrada', 404);
  return e;
}

export async function updateEntry(userId: string, id: string, input: UpdateEntryInput) {
  const res = await prisma.journalEntry.updateMany({ where: { id, userId }, data: input });
  if (res.count === 0) throw new AppError('NOT_FOUND', 'Entrada não encontrada', 404);
  return getEntry(userId, id);
}

export async function deleteEntry(userId: string, id: string): Promise<void> {
  const res = await prisma.journalEntry.deleteMany({ where: { id, userId } });
  if (res.count === 0) throw new AppError('NOT_FOUND', 'Entrada não encontrada', 404);
}
