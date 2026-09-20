import { prisma } from '../../db/client.js';

interface DailyRow {
  date: string;
  moodOverall: number | null;
  connectionScore: number | null;
  communicationScore: number | null;
  affectionScore: number | null;
  partnershipScore: number | null;
  emotionalScore: number | null;
  sleepHours: number | null;
  exercisedToday: boolean;
  frictionToday: boolean;
  intimacyToday: boolean;
  hasPositiveMemory: boolean;
}

async function userTimezone(userId: string): Promise<string> {
  const p = await prisma.profile.findUnique({ where: { userId }, select: { timezone: true } });
  return p?.timezone ?? 'America/Sao_Paulo';
}

function todayInTz(tz: string): Date {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
}

async function partnerIdOf(userId: string): Promise<string | null> {
  const couple = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { userAId: true, userBId: true },
  });
  if (!couple) return null;
  return couple.userAId === userId ? couple.userBId : couple.userAId;
}

function buildDates(from: Date, to: Date): Date[] {
  const arr: Date[] = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    arr.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return arr;
}

export async function getEvolution(
  userId: string,
  days: number,
): Promise<{
  from: string;
  to: string;
  me: DailyRow[];
  partner: {
    name: string;
    rows: DailyRow[];
  } | null;
  summary: {
    checkinDaysMe: number;
    checkinDaysPartner: number;
    avgMoodMe: number | null;
    avgMoodPartner: number | null;
    frictionDays: number;
    intimacyDays: number;
    positiveMemories: number;
    exerciseDays: number;
    avgSleep: number | null;
  };
}> {
  const tz = await userTimezone(userId);
  const to = todayInTz(tz);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));

  const dates = buildDates(from, to);
  const partnerId = await partnerIdOf(userId);

  const [mineRaw, partnerRaw, partnerUser] = await Promise.all([
    prisma.checkIn.findMany({
      where: { userId, date: { gte: from, lte: to } },
      select: {
        date: true,
        moodOverall: true,
        connectionScore: true,
        communicationScore: true,
        affectionScore: true,
        partnershipScore: true,
        emotionalScore: true,
        sleepHours: true,
        exercisedToday: true,
        frictionToday: true,
        intimacyToday: true,
        positiveMemory: true,
      },
    }),
    partnerId
      ? prisma.checkIn.findMany({
          where: {
            userId: partnerId,
            date: { gte: from, lte: to },
            sharedWithPartner: true,
          },
          select: {
            date: true,
            moodOverall: true,
            connectionScore: true,
            communicationScore: true,
            affectionScore: true,
            partnershipScore: true,
            emotionalScore: true,
            sleepHours: true,
            exercisedToday: true,
            frictionToday: true,
            intimacyToday: true,
          },
        })
      : Promise.resolve([]),
    partnerId
      ? prisma.user.findUnique({ where: { id: partnerId }, select: { name: true } })
      : Promise.resolve(null),
  ]);

  function fillDaily(
    raw: {
      date: Date;
      moodOverall: number | null;
      connectionScore: number | null;
      communicationScore: number | null;
      affectionScore: number | null;
      partnershipScore: number | null;
      emotionalScore: number | null;
      sleepHours: number | null;
      exercisedToday: boolean;
      frictionToday: boolean;
      intimacyToday: boolean;
      positiveMemory?: string | null;
    }[],
  ): DailyRow[] {
    const map = new Map(raw.map((r) => [r.date.toISOString().slice(0, 10), r]));
    return dates.map((d) => {
      const key = d.toISOString().slice(0, 10);
      const hit = map.get(key);
      return {
        date: key,
        moodOverall: hit?.moodOverall ?? null,
        connectionScore: hit?.connectionScore ?? null,
        communicationScore: hit?.communicationScore ?? null,
        affectionScore: hit?.affectionScore ?? null,
        partnershipScore: hit?.partnershipScore ?? null,
        emotionalScore: hit?.emotionalScore ?? null,
        sleepHours: hit?.sleepHours ?? null,
        exercisedToday: hit?.exercisedToday ?? false,
        frictionToday: hit?.frictionToday ?? false,
        intimacyToday: hit?.intimacyToday ?? false,
        hasPositiveMemory: Boolean(hit?.positiveMemory),
      };
    });
  }

  const me = fillDaily(mineRaw);
  const partnerRows = partnerId ? fillDaily(partnerRaw) : [];

  function avg(nums: (number | null)[]): number | null {
    const filtered = nums.filter((n): n is number => typeof n === 'number');
    if (filtered.length === 0) return null;
    return Math.round((filtered.reduce((a, b) => a + b, 0) / filtered.length) * 10) / 10;
  }

  const summary = {
    checkinDaysMe: mineRaw.length,
    checkinDaysPartner: partnerRaw.length,
    avgMoodMe: avg(mineRaw.map((r) => r.moodOverall)),
    avgMoodPartner: avg(partnerRaw.map((r) => r.moodOverall)),
    frictionDays: mineRaw.filter((r) => r.frictionToday).length,
    intimacyDays: mineRaw.filter((r) => r.intimacyToday).length,
    positiveMemories: mineRaw.filter((r) => r.positiveMemory).length,
    exerciseDays: mineRaw.filter((r) => r.exercisedToday).length,
    avgSleep: avg(mineRaw.map((r) => r.sleepHours)),
  };

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    me,
    partner: partnerUser
      ? {
          name: partnerUser.name,
          rows: partnerRows,
        }
      : null,
    summary,
  };
}
