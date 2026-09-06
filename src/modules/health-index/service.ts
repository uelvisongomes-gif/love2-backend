import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { PILLARS } from '../profile/schema.js';

const BASE = 60;

interface Weekly {
  badEventsCount: number;
  goodEventsCount: number;
  intimacyDays: number;
  dateNights: number;
  tasksCompleted: number;
  tasksPending: number;
}

export async function computeHealth(userId: string): Promise<{
  overall: number;
  byPillar: Record<string, number>;
  weekly: Weekly;
}> {
  const couple = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true, userAId: true, userBId: true },
  });
  if (!couple) throw new AppError('NO_COUPLE', 'Você ainda não está vinculado a um casal', 403);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const bothUserIds = [couple.userAId, couple.userBId];

  const checkins = await prisma.checkIn.findMany({
    where: { userId: { in: bothUserIds }, date: { gte: sevenDaysAgo } },
    include: { events: true },
  });
  const tasks = await prisma.coupleTask.findMany({
    where: { coupleId: couple.id },
  });

  const events = checkins.flatMap((c) => c.events);
  const goodEvents = events.filter((e) => e.kind === 'good');
  const badEvents = events.filter((e) => e.kind === 'bad');
  const intimacyDays = checkins.filter((c) => c.intimacyToday).length;
  const dateNights = checkins.filter((c) => c.dateNightToday).length;
  const completedTasks = tasks.filter((t) => t.completedAt && t.completedAt >= sevenDaysAgo);
  const pendingOld = tasks.filter((t) => !t.completedAt && t.createdAt < sevenDaysAgo);

  function score(good: number, bad: number, intimacy: number, dates: number, done: number, pending: number): number {
    const s =
      BASE +
      Math.min(good * 3, 25) -
      Math.min(bad * 3, 30) +
      intimacy * 2 +
      dates * 2 +
      done * 3 -
      pending * 2;
    return Math.max(0, Math.min(100, s));
  }

  const overall = score(
    goodEvents.length,
    badEvents.length,
    intimacyDays,
    dateNights,
    completedTasks.length,
    pendingOld.length,
  );

  const byPillar: Record<string, number> = {};
  for (const p of PILLARS) {
    const g = goodEvents.filter((e) => e.pillar === p).length;
    const b = badEvents.filter((e) => e.pillar === p).length;
    const done = completedTasks.filter((t) => t.pillar === p).length;
    const pend = pendingOld.filter((t) => t.pillar === p).length;
    byPillar[p] = score(g, b, 0, 0, done, pend);
  }

  const weekly: Weekly = {
    badEventsCount: badEvents.length,
    goodEventsCount: goodEvents.length,
    intimacyDays,
    dateNights,
    tasksCompleted: completedTasks.length,
    tasksPending: pendingOld.length,
  };

  return { overall, byPillar, weekly };
}
