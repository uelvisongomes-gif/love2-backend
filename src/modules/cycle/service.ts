import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { getEmailSender } from '../auth/email.js';
import type { DailyLogInput, LogPeriodInput, UpdateProfileInput } from './schema.js';

const CARE_LABELS: Record<string, string> = {
  mais_carinho: 'Prefere mais carinho',
  mais_espaco: 'Prefere mais espaço',
  paciencia_com_sensibilidade: 'Paciência com sensibilidade',
  ajuda_nas_tarefas: 'Ajuda nas tarefas do dia',
  evitar_conversas_dificeis: 'Adiar conversas difíceis',
  perguntar_como_estou: 'Perguntar como está antes de presumir',
  lembrar_de_comprar_o_que_preciso: 'Lembrar de comprar o que ela costuma precisar',
};

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
 * Roda a cada hora. Pra cada mulher com sharePreMenstrual ativado,
 * calcula quando começa a TPM. Se for AMANHÃ, manda email pro parceiro hoje.
 */
export async function runCycleNotifications(): Promise<{ sent: number }> {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const profiles = await prisma.cycleProfile.findMany({
    where: { shareWithPartner: true, sharePreMenstrual: true },
  });

  let sent = 0;
  for (const p of profiles) {
    try {
      const pred = await predict(p.userId);
      if (!pred.nextPreMenstrual) continue;
      // Se a TPM prevista começa amanhã, hoje é o dia de avisar
      if (pred.nextPreMenstrual !== tomorrowStr) continue;
      // Já avisou hoje?
      const today = new Date(todayStr);
      const already = await prisma.cycleNotificationLog.findUnique({
        where: {
          userId_kind_sentDate: { userId: p.userId, kind: 'pre_menstrual', sentDate: today },
        },
      });
      if (already) continue;
      // Pega parceiro
      const couple = await prisma.couple.findFirst({
        where: { OR: [{ userAId: p.userId }, { userBId: p.userId }] },
        select: { userAId: true, userBId: true },
      });
      if (!couple) continue;
      const partnerId = couple.userAId === p.userId ? couple.userBId : couple.userAId;
      const [partner, her] = await Promise.all([
        prisma.user.findUnique({ where: { id: partnerId }, select: { email: true, name: true } }),
        prisma.user.findUnique({ where: { id: p.userId }, select: { name: true } }),
      ]);
      if (!partner?.email) continue;
      const prefs = (p.sharePreferences ? (p.carePreferences as string[] | null) : null) ?? [];
      const prefsHtml = prefs.length > 0
        ? `<p style="font-size:15px;color:#333;margin:16px 0 8px;"><strong>Como ela gosta de ser cuidada:</strong></p>
           <ul style="font-size:15px;color:#333;line-height:1.6;margin:0;padding-left:20px;">
             ${prefs.map((v) => `<li>${CARE_LABELS[v] ?? v}</li>`).join('')}
           </ul>`
        : '';
      const noteHtml = p.sharePreferences && p.customNote
        ? `<div style="background:#faf7f2;border-left:3px solid #e6604a;padding:12px 16px;border-radius:4px;margin:16px 0;font-size:14px;color:#333;">${p.customNote}</div>`
        : '';
      const subject = `❤️ Um lembrete de cuidado`;
      const text = `Oi${partner.name ? `, ${partner.name}` : ''}!\n\nDe acordo com o ciclo que ${her?.name ?? 'sua parceira'} compartilha com você, os próximos dias podem ser um período em que ela costuma precisar de um pouco mais de atenção.\n\nQue tal perguntar como ela tá?\n\nVer mais em https://www.love2.com.br/ciclo-parceira\n\n— love2`;
      const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#e6604a;font-weight:500;">❤️ Um lembrete de cuidado</h2>
        <p style="font-size:16px;color:#333;line-height:1.6;">
          De acordo com o ciclo que <strong>${her?.name ?? 'sua parceira'}</strong> compartilha com você, os próximos dias podem ser um período em que ela costuma precisar de um pouco mais de atenção.
        </p>
        <p style="font-size:16px;color:#333;line-height:1.6;">
          Cada pessoa vive esse período de um jeito diferente — <strong>não é sobre suposição, é sobre presença</strong>.
        </p>
        ${prefsHtml}
        ${noteHtml}
        <a href="https://www.love2.com.br/ciclo-parceira" style="display:inline-block;background:#e6604a;color:white;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600;margin-top:16px;">Ver como ela gosta de ser cuidada</a>
        <p style="color:#999;font-size:12px;margin-top:32px;">Você recebeu esse email porque ela autorizou compartilhar o ciclo com você. Ela pode desligar essa opção a qualquer momento.</p>
      </div>`;
      await getEmailSender().send(partner.email, subject, text, html);
      await prisma.cycleNotificationLog.create({
        data: { userId: p.userId, kind: 'pre_menstrual', sentDate: today },
      });
      sent++;
    } catch (err) {
      console.log('[cycle notify]', p.userId, (err as Error).message);
    }
  }
  return { sent };
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
