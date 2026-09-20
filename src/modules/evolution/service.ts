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

// Categorização simples por keyword matching (regex tolerante)
const FRICTION_CATEGORIES: { key: string; label: string; patterns: RegExp[] }[] = [
  {
    key: 'financeiro',
    label: 'Dinheiro',
    patterns: [/dinheir/i, /financ/i, /conta[s]?\b/i, /gast/i, /divid/i, /cart[aã]o/i, /salar/i, /economi/i],
  },
  {
    key: 'filhos',
    label: 'Filhos',
    patterns: [/filho/i, /crian[çc]a/i, /escola/i, /educa[çc][aã]o/i, /beb[eê]/i, /adolescent/i],
  },
  {
    key: 'intimidade',
    label: 'Intimidade / sexo',
    patterns: [/sexo/i, /intim/i, /desejo/i, /cari?nho/i, /toque/i, /cama\b/i],
  },
  {
    key: 'divisao_tarefas',
    label: 'Divisão de tarefas',
    patterns: [/tarefa/i, /limpe/i, /fazer\s+(a\s+)?comida/i, /louça/i, /roupa/i, /faxina/i, /casa\b/i, /organiz/i],
  },
  {
    key: 'familia_extendida',
    label: 'Família / sogros',
    patterns: [/sogr[oa]/i, /minha m[ãa]e/i, /meu pai/i, /cunhad/i, /fam[ií]lia dele/i, /fam[ií]lia dela/i],
  },
  {
    key: 'trabalho',
    label: 'Trabalho / rotina',
    patterns: [/trabalho/i, /emprego/i, /chefe/i, /reuni[aã]o/i, /viag(em|ens)/i, /hor[aá]rio/i],
  },
  {
    key: 'ciume',
    label: 'Ciúmes / redes sociais',
    patterns: [/ciume|ci[uú]me/i, /mensagem/i, /whatsapp/i, /instagram/i, /rede social/i],
  },
  {
    key: 'comunicacao',
    label: 'Comunicação',
    patterns: [/n[aã]o\s+conversa/i, /n[aã]o\s+escuta/i, /mal\s+entendido/i, /entendeu\s+errado/i, /grito|grita/i],
  },
  {
    key: 'tempo_casal',
    label: 'Tempo do casal',
    patterns: [/celular/i, /tempo\s+juntos/i, /namoro/i, /sair juntos/i, /encontro/i, /ausente/i, /distante/i],
  },
  {
    key: 'religiao_valores',
    label: 'Valores / religião',
    patterns: [/religi[aã]o/i, /igreja/i, /culto/i, /f[eé]\b/i, /valor(es)?\b/i],
  },
];

function categorizeFriction(note: string | null | undefined): string | null {
  if (!note || !note.trim()) return null;
  for (const cat of FRICTION_CATEGORIES) {
    for (const pat of cat.patterns) {
      if (pat.test(note)) return cat.label;
    }
  }
  return 'Outros';
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
    topFrictionReasons: { label: string; count: number }[];
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
        frictionNote: true,
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

  // Contagem de motivos de atrito por categoria
  const frictionCounts = new Map<string, number>();
  for (const r of mineRaw) {
    if (!r.frictionToday) continue;
    const cat = categorizeFriction(r.frictionNote);
    if (!cat) continue;
    frictionCounts.set(cat, (frictionCounts.get(cat) ?? 0) + 1);
  }
  const topFrictionReasons = Array.from(frictionCounts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

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
    topFrictionReasons,
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
