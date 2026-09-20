import { prisma } from '../../db/client.js';
import type { CheckinTodayInput, CheckinV2Input } from './schema.js';

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

export async function upsertTodayCheckinV2(userId: string, input: CheckinV2Input) {
  const tz = await userTimezone(userId);
  const date = todayInTz(tz);
  // moodOverall derivado da média dos 5 scores (1-5 → 1-10 aprox)
  const scores = [
    input.connectionScore,
    input.communicationScore,
    input.affectionScore,
    input.partnershipScore,
    input.emotionalScore,
  ];
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const moodOverall = Math.max(1, Math.min(10, Math.round(avg * 2)));

  const extra = {
    sleepHours: input.sleepHours ?? null,
    exercisedToday: input.exercisedToday ?? false,
    frictionToday: input.frictionToday ?? false,
    frictionNote: input.frictionNote ?? null,
    positiveMemory: input.positiveMemory ?? null,
    intimacyToday: input.intimacyToday ?? false,
  };

  return prisma.checkIn.upsert({
    where: { userId_date: { userId, date } },
    create: {
      userId,
      date,
      moodOverall,
      connectionScore: input.connectionScore,
      communicationScore: input.communicationScore,
      affectionScore: input.affectionScore,
      partnershipScore: input.partnershipScore,
      emotionalScore: input.emotionalScore,
      openNote: input.openNote ?? null,
      sharedWithPartner: input.sharedWithPartner,
      ...extra,
    },
    update: {
      moodOverall,
      connectionScore: input.connectionScore,
      communicationScore: input.communicationScore,
      affectionScore: input.affectionScore,
      partnershipScore: input.partnershipScore,
      emotionalScore: input.emotionalScore,
      openNote: input.openNote ?? null,
      sharedWithPartner: input.sharedWithPartner,
      ...extra,
    },
  });
}

export interface CheckinHistoryRow {
  date: string;
  connectionScore: number | null;
  communicationScore: number | null;
  affectionScore: number | null;
  partnershipScore: number | null;
  emotionalScore: number | null;
  openNote: string | null;
  moodOverall: number | null;
  sharedWithPartner: boolean;
  who: 'me' | 'partner';
}

async function partnerIdOf(userId: string): Promise<string | null> {
  const couple = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { userAId: true, userBId: true },
  });
  if (!couple) return null;
  return couple.userAId === userId ? couple.userBId : couple.userAId;
}

export async function checkinHistory(
  userId: string,
  days: number,
): Promise<{ checkins: CheckinHistoryRow[] }> {
  const tz = await userTimezone(userId);
  const today = todayInTz(tz);
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - (days - 1));

  const partnerId = await partnerIdOf(userId);

  const [mine, partner] = await Promise.all([
    prisma.checkIn.findMany({
      where: { userId, date: { gte: from, lte: today } },
      orderBy: { date: 'asc' },
      select: {
        date: true,
        connectionScore: true,
        communicationScore: true,
        affectionScore: true,
        partnershipScore: true,
        emotionalScore: true,
        openNote: true,
        moodOverall: true,
        sharedWithPartner: true,
      },
    }),
    partnerId
      ? prisma.checkIn.findMany({
          where: {
            userId: partnerId,
            date: { gte: from, lte: today },
            sharedWithPartner: true,
          },
          orderBy: { date: 'asc' },
          select: {
            date: true,
            connectionScore: true,
            communicationScore: true,
            affectionScore: true,
            partnershipScore: true,
            emotionalScore: true,
            // openNote do parceiro NÃO é exposto — segurança
            moodOverall: true,
            sharedWithPartner: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const rows: CheckinHistoryRow[] = [
    ...mine.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      connectionScore: r.connectionScore,
      communicationScore: r.communicationScore,
      affectionScore: r.affectionScore,
      partnershipScore: r.partnershipScore,
      emotionalScore: r.emotionalScore,
      openNote: r.openNote,
      moodOverall: r.moodOverall,
      sharedWithPartner: r.sharedWithPartner,
      who: 'me' as const,
    })),
    ...partner.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      connectionScore: r.connectionScore,
      communicationScore: r.communicationScore,
      affectionScore: r.affectionScore,
      partnershipScore: r.partnershipScore,
      emotionalScore: r.emotionalScore,
      openNote: null,
      moodOverall: r.moodOverall,
      sharedWithPartner: r.sharedWithPartner,
      who: 'partner' as const,
    })),
  ];
  return { checkins: rows };
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
