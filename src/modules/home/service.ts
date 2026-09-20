import { prisma } from '../../db/client.js';

interface TodayCheckin {
  done: boolean;
  moodOverall: number | null;
  sharedWithPartner: boolean;
  connectionScore: number | null;
  positiveMemory: string | null;
  frictionToday: boolean;
}

interface PartnerToday {
  name: string;
  photoUrl: string | null;
  checkin: { done: boolean; moodOverall: number | null } | null;
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

async function computeStreak(userId: string, today: Date): Promise<number> {
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 30);
  const rows = await prisma.checkIn.findMany({
    where: { userId, date: { gte: from, lte: today } },
    orderBy: { date: 'desc' },
    select: { date: true },
  });
  let streak = 0;
  const cursor = new Date(today);
  const seen = new Set(rows.map((r) => r.date.toISOString().slice(0, 10)));
  while (seen.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export async function getHomeSummary(userId: string): Promise<{
  me: { name: string; photoUrl: string | null };
  todayCheckin: TodayCheckin;
  partner: PartnerToday | null;
  openAgreements: number;
  tasksToday: { id: string; title: string; category: string | null }[];
  streakDays: number;
  lastPositiveMemory: { text: string; date: string } | null;
  hasCoupleLink: boolean;
}> {
  const tz = await userTimezone(userId);
  const today = todayInTz(tz);

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, photoUrl: true },
  });

  const couple = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true, userAId: true, userBId: true },
  });
  const partnerId = couple ? (couple.userAId === userId ? couple.userBId : couple.userAId) : null;

  const [myCheckin, partnerUser, partnerCheckin, agreementsCount, tasksToday, lastPositive, streak] =
    await Promise.all([
      prisma.checkIn.findUnique({
        where: { userId_date: { userId, date: today } },
        select: {
          moodOverall: true,
          sharedWithPartner: true,
          connectionScore: true,
          positiveMemory: true,
          frictionToday: true,
        },
      }),
      partnerId
        ? prisma.user.findUnique({
            where: { id: partnerId },
            select: { name: true, photoUrl: true },
          })
        : Promise.resolve(null),
      partnerId
        ? prisma.checkIn.findUnique({
            where: { userId_date: { userId: partnerId, date: today } },
            select: { moodOverall: true, sharedWithPartner: true },
          })
        : Promise.resolve(null),
      prisma.agreement.count({
        where: {
          status: 'em_andamento',
          OR: couple
            ? [{ coupleId: couple.id }, { coupleId: null, createdBy: userId }]
            : [{ coupleId: null, createdBy: userId }],
        },
      }),
      prisma.coupleTask.findMany({
        where: {
          OR: couple
            ? [
                { coupleId: couple.id, completedAt: null },
                { coupleId: null, createdBy: userId, completedAt: null },
              ]
            : [{ coupleId: null, createdBy: userId, completedAt: null }],
          dueBy: { lte: new Date(today.getTime() + 24 * 60 * 60 * 1000) },
        },
        orderBy: { dueBy: 'asc' },
        take: 3,
        select: { id: true, title: true, category: true },
      }),
      prisma.checkIn.findFirst({
        where: { userId, positiveMemory: { not: null } },
        orderBy: { date: 'desc' },
        select: { positiveMemory: true, date: true },
      }),
      computeStreak(userId, today),
    ]);

  return {
    me: { name: me?.name ?? '', photoUrl: me?.photoUrl ?? null },
    todayCheckin: {
      done: Boolean(myCheckin),
      moodOverall: myCheckin?.moodOverall ?? null,
      sharedWithPartner: myCheckin?.sharedWithPartner ?? false,
      connectionScore: myCheckin?.connectionScore ?? null,
      positiveMemory: myCheckin?.positiveMemory ?? null,
      frictionToday: myCheckin?.frictionToday ?? false,
    },
    partner: partnerUser
      ? {
          name: partnerUser.name,
          photoUrl: partnerUser.photoUrl,
          checkin:
            partnerCheckin && partnerCheckin.sharedWithPartner
              ? { done: true, moodOverall: partnerCheckin.moodOverall }
              : partnerCheckin
                ? { done: true, moodOverall: null } // fez mas não compartilhou notas
                : { done: false, moodOverall: null },
        }
      : null,
    openAgreements: agreementsCount,
    tasksToday,
    streakDays: streak,
    lastPositiveMemory:
      lastPositive?.positiveMemory && lastPositive.date
        ? { text: lastPositive.positiveMemory, date: lastPositive.date.toISOString().slice(0, 10) }
        : null,
    hasCoupleLink: Boolean(couple),
  };
}
