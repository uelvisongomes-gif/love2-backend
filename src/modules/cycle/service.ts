import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import type { DailyLogInput, LogPeriodInput, UpdateProfileInput } from './schema.js';

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

export async function getOrCreateProfile(userId: string) {
  const p = await prisma.cycleProfile.findUnique({ where: { userId } });
  if (p) return p;
  return prisma.cycleProfile.create({ data: { userId } });
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  await getOrCreateProfile(userId);
  const data: Record<string, unknown> = {};
  const fields: (keyof UpdateProfileInput)[] = [
    'averageCycleDays', 'averagePeriodDays', 'premenstrualDays',
    'shareWithPartner', 'sharePeriodStart', 'sharePreMenstrual', 'sharePreferences',
    'carePreferences', 'customNote',
  ];
  for (const f of fields) {
    if (input[f] !== undefined) data[f] = input[f];
  }
  return prisma.cycleProfile.update({ where: { userId }, data });
}

export async function logPeriod(userId: string, input: LogPeriodInput) {
  return prisma.cyclePeriod.upsert({
    where: { userId_startDate: { userId, startDate: parseDate(input.startDate) } },
    create: {
      userId,
      startDate: parseDate(input.startDate),
      endDate: input.endDate ? parseDate(input.endDate) : null,
    },
    update: {
      endDate: input.endDate ? parseDate(input.endDate) : null,
    },
  });
}

export async function deletePeriod(userId: string, id: string): Promise<void> {
  const res = await prisma.cyclePeriod.deleteMany({ where: { id, userId } });
  if (res.count === 0) throw new AppError('NOT_FOUND', 'Registro não encontrado', 404);
}

export async function listPeriods(userId: string) {
  const periods = await prisma.cyclePeriod.findMany({
    where: { userId },
    orderBy: { startDate: 'desc' },
    take: 24,
  });
  return { periods };
}

export async function upsertDailyLog(userId: string, input: DailyLogInput) {
  return prisma.cycleDailyLog.upsert({
    where: { userId_date: { userId, date: parseDate(input.date) } },
    create: {
      userId,
      date: parseDate(input.date),
      symptoms: input.symptoms as unknown as object,
      note: input.note ?? null,
    },
    update: {
      symptoms: input.symptoms as unknown as object,
      note: input.note ?? null,
    },
  });
}

export async function listDailyLogs(userId: string, fromDays: number = 60) {
  const from = new Date();
  from.setDate(from.getDate() - fromDays);
  const logs = await prisma.cycleDailyLog.findMany({
    where: { userId, date: { gte: from } },
    orderBy: { date: 'desc' },
  });
  return { logs };
}

export interface CyclePrediction {
  nextPeriodStart: string | null;
  nextPreMenstrual: string | null;
  daysUntilPeriod: number | null;
  currentPhase: 'menstruacao' | 'folicular' | 'ovulacao' | 'lutea' | 'pre_menstrual' | null;
}

export async function predict(userId: string): Promise<CyclePrediction> {
  const profile = await getOrCreateProfile(userId);
  const periods = await prisma.cyclePeriod.findMany({
    where: { userId },
    orderBy: { startDate: 'desc' },
    take: 6,
  });
  if (periods.length === 0) {
    return { nextPeriodStart: null, nextPreMenstrual: null, daysUntilPeriod: null, currentPhase: null };
  }
  const last = periods[0]!;
  const cycle = profile.averageCycleDays;
  const nextStart = new Date(last.startDate);
  nextStart.setUTCDate(nextStart.getUTCDate() + cycle);
  const preMenstrual = new Date(nextStart);
  preMenstrual.setUTCDate(preMenstrual.getUTCDate() - profile.premenstrualDays);
  const now = new Date();
  const daysUntil = Math.ceil((nextStart.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  const daysSinceStart = Math.floor(
    (now.getTime() - last.startDate.getTime()) / (1000 * 60 * 60 * 24),
  );
  let phase: CyclePrediction['currentPhase'] = null;
  if (daysSinceStart < profile.averagePeriodDays) phase = 'menstruacao';
  else if (daysSinceStart < 13) phase = 'folicular';
  else if (daysSinceStart < 17) phase = 'ovulacao';
  else if (daysUntil > profile.premenstrualDays) phase = 'lutea';
  else phase = 'pre_menstrual';

  return {
    nextPeriodStart: nextStart.toISOString().slice(0, 10),
    nextPreMenstrual: preMenstrual.toISOString().slice(0, 10),
    daysUntilPeriod: daysUntil,
    currentPhase: phase,
  };
}

/**
 * Retorna o que a parceira do userId autoriza compartilhar (view do parceiro).
 */
export async function partnerView(viewerId: string): Promise<{
  hasPartner: boolean;
  hasAccess: boolean;
  partnerName?: string;
  prediction?: {
    nextPeriodStart?: string;
    nextPreMenstrual?: string;
    daysUntilPeriod?: number;
    currentPhase?: string;
  };
  preferences?: string[];
  customNote?: string | null;
}> {
  const couple = await prisma.couple.findFirst({
    where: { OR: [{ userAId: viewerId }, { userBId: viewerId }] },
    select: { userAId: true, userBId: true },
  });
  if (!couple) return { hasPartner: false, hasAccess: false };
  const partnerId = couple.userAId === viewerId ? couple.userBId : couple.userAId;
  const [partnerUser, profile] = await Promise.all([
    prisma.user.findUnique({ where: { id: partnerId }, select: { name: true } }),
    prisma.cycleProfile.findUnique({ where: { userId: partnerId } }),
  ]);
  if (!profile || !profile.shareWithPartner) {
    return { hasPartner: true, hasAccess: false, partnerName: partnerUser?.name ?? undefined };
  }
  const pred = await predict(partnerId);
  const result: {
    hasPartner: boolean;
    hasAccess: boolean;
    partnerName?: string;
    prediction: {
      nextPeriodStart?: string;
      nextPreMenstrual?: string;
      daysUntilPeriod?: number;
      currentPhase?: string;
    };
    preferences?: string[];
    customNote?: string | null;
  } = {
    hasPartner: true,
    hasAccess: true,
    partnerName: partnerUser?.name ?? undefined,
    prediction: {},
  };
  if (profile.sharePeriodStart && pred.nextPeriodStart) {
    result.prediction.nextPeriodStart = pred.nextPeriodStart;
    result.prediction.daysUntilPeriod = pred.daysUntilPeriod ?? undefined;
    result.prediction.currentPhase = pred.currentPhase ?? undefined;
  }
  if (profile.sharePreMenstrual && pred.nextPreMenstrual) {
    result.prediction.nextPreMenstrual = pred.nextPreMenstrual;
  }
  if (profile.sharePreferences) {
    result.preferences = (profile.carePreferences as string[] | null) ?? [];
    result.customNote = profile.customNote;
  }
  return result;
}
