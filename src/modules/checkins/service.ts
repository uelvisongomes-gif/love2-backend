import { prisma } from '../../db/client.js';
import type { CheckinTodayInput } from './schema.js';

async function userTimezone(userId: string): Promise<string> {
  const p = await prisma.profile.findUnique({ where: { userId }, select: { timezone: true } });
  return p?.timezone ?? 'America/Sao_Paulo';
}

function todayInTz(tz: string): Date {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
}

export async function upsertTodayCheckin(userId: string, input: CheckinTodayInput) {
  const tz = await userTimezone(userId);
  const date = todayInTz(tz);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.checkIn.findUnique({ where: { userId_date: { userId, date } } });
    if (existing) {
      await tx.event.deleteMany({ where: { checkInId: existing.id } });
    }
    return tx.checkIn.upsert({
      where: { userId_date: { userId, date } },
      create: {
        userId,
        date,
        moodOverall: input.moodOverall,
        intimacyToday: input.intimacyToday,
        dateNightToday: input.dateNightToday,
        events: { create: input.events },
      },
      update: {
        moodOverall: input.moodOverall,
        intimacyToday: input.intimacyToday,
        dateNightToday: input.dateNightToday,
        events: { create: input.events },
      },
      include: { events: true },
    });
  });
}

export async function last7Days(userId: string): Promise<{
  checkins: { date: string; moodOverall: number | null; intimacyToday: boolean; dateNightToday: boolean }[];
}> {
  const tz = await userTimezone(userId);
  const today = todayInTz(tz);
  const days: Date[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d);
  }
  const rows = await prisma.checkIn.findMany({
    where: { userId, date: { in: days } },
    select: { date: true, moodOverall: true, intimacyToday: true, dateNightToday: true },
  });
  const map = new Map(rows.map((r) => [r.date.toISOString().slice(0, 10), r]));
  const checkins = days.map((d) => {
    const key = d.toISOString().slice(0, 10);
    const hit = map.get(key);
    return {
      date: key,
      moodOverall: hit?.moodOverall ?? null,
      intimacyToday: hit?.intimacyToday ?? false,
      dateNightToday: hit?.dateNightToday ?? false,
    };
  });
  return { checkins };
}
