import { prisma } from '../db/client.js';

/**
 * Monta o bloco de contexto do usuário pra LOVE — perfil, tendências de check-in,
 * acordos em andamento, se tem parceiro linkado. Sempre respeitando privacidade:
 * nunca inclui dados privados do parceiro (openNote do parceiro, mensagens do parceiro).
 */

interface CheckinAverage {
  connection: number | null;
  communication: number | null;
  affection: number | null;
  partnership: number | null;
  emotional: number | null;
}

function avg(nums: (number | null)[]): number | null {
  const clean = nums.filter((n): n is number => n !== null);
  if (clean.length === 0) return null;
  return Math.round((clean.reduce((a, b) => a + b, 0) / clean.length) * 10) / 10;
}

function partnerPronoun(gender: string | null): {
  ele_ela: string;
  dele_dela: string;
  o_a: string;
  parceiro_parceira: string;
} {
  if (gender === 'homem') {
    return { ele_ela: 'ele', dele_dela: 'dele', o_a: 'o', parceiro_parceira: 'parceiro' };
  }
  if (gender === 'mulher') {
    return { ele_ela: 'ela', dele_dela: 'dela', o_a: 'a', parceiro_parceira: 'parceira' };
  }
  return { ele_ela: 'ele/ela', dele_dela: 'dele/dela', o_a: 'o/a', parceiro_parceira: 'parceiro(a)' };
}

export async function buildUserContextBlock(userId: string): Promise<string> {
  const [user, profile, checkins, agreements, couple] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    }),
    prisma.profile.findUnique({
      where: { userId },
      select: {
        relationshipYears: true,
        hasChildren: true,
        livingTogether: true,
        loveLanguagesRanking: true,
        pillarScores: true,
        gender: true,
      },
    }),
    // Últimos 14 dias — média por dimensão
    prisma.checkIn.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: 14,
      select: {
        connectionScore: true,
        communicationScore: true,
        affectionScore: true,
        partnershipScore: true,
        emotionalScore: true,
      },
    }),
    // Acordos ativos (em_andamento) — se está em casal, todos do casal; senão os próprios
    prisma.$transaction(async (tx) => {
      const c = await tx.couple.findFirst({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
        select: { id: true },
      });
      return tx.agreement.findMany({
        where: {
          status: 'em_andamento',
          OR: c ? [{ coupleId: c.id }, { createdBy: userId }] : [{ createdBy: userId }],
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { title: true, content: true, pillar: true },
      });
    }),
    prisma.couple.findFirst({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      select: { id: true, userAId: true, userBId: true },
    }),
  ]);

  // Se em casal, pega dados básicos do parceiro pra saber gênero + nome
  let partnerInfo: { name: string; gender: string | null } | null = null;
  if (couple) {
    const partnerId = couple.userAId === userId ? couple.userBId : couple.userAId;
    const [partnerUser, partnerProfile] = await Promise.all([
      prisma.user.findUnique({ where: { id: partnerId }, select: { name: true } }),
      prisma.profile.findUnique({ where: { userId: partnerId }, select: { gender: true } }),
    ]);
    if (partnerUser) {
      partnerInfo = { name: partnerUser.name, gender: partnerProfile?.gender ?? null };
    }
  }

  const lines: string[] = ['CONTEXTO DO USUÁRIO (pra você referenciar quando relevante — sem citar como se fosse ficha):'];

  if (user?.name) lines.push(`- Nome do usuário: ${user.name}.`);
  if (profile?.gender) {
    lines.push(`- Gênero do usuário: ${profile.gender === 'homem' ? 'homem' : profile.gender === 'mulher' ? 'mulher' : profile.gender}.`);
  }

  if (partnerInfo) {
    lines.push(`- Nome do(a) parceiro(a): ${partnerInfo.name}.`);
    if (partnerInfo.gender) {
      const p = partnerPronoun(partnerInfo.gender);
      lines.push(`- Gênero do(a) parceiro(a): ${partnerInfo.gender === 'homem' ? 'homem' : partnerInfo.gender === 'mulher' ? 'mulher' : partnerInfo.gender}.`);
      lines.push(`- PRONOMES CERTOS ao falar do parceiro: use "${p.ele_ela}", "${p.dele_dela}", "${p.parceiro_parceira}" — NUNCA inverta.`);
    } else {
      lines.push('- ATENÇÃO: gênero do parceiro não informado. Use linguagem neutra ("seu parceiro", "essa pessoa") até saber.');
    }
  }

  if (profile) {
    if (profile.relationshipYears != null) {
      lines.push(`- Tempo de relacionamento: ${profile.relationshipYears} ano(s).`);
    }
    if (profile.hasChildren != null) {
      lines.push(`- Tem filhos: ${profile.hasChildren ? 'sim' : 'não'}.`);
    }
    if (profile.livingTogether != null) {
      lines.push(`- Moram juntos: ${profile.livingTogether ? 'sim' : 'não'}.`);
    }
    if (
      Array.isArray(profile.loveLanguagesRanking) &&
      profile.loveLanguagesRanking.length > 0
    ) {
      const langs = (profile.loveLanguagesRanking as string[]).slice(0, 2).join(' e ');
      lines.push(`- Linguagens do amor mais fortes: ${langs}.`);
    }
    if (profile.pillarScores && typeof profile.pillarScores === 'object') {
      const scores = profile.pillarScores as Record<string, number>;
      const low = Object.entries(scores)
        .filter(([, v]) => typeof v === 'number' && v <= 4)
        .map(([k]) => k);
      if (low.length > 0) {
        lines.push(`- Pilares que a pessoa marcou como difíceis: ${low.join(', ')}.`);
      }
    }
  }

  lines.push(`- Está em casal linkado: ${couple ? 'sim' : 'não (solo por enquanto)'}.`);

  if (checkins.length > 0) {
    const stats: CheckinAverage = {
      connection: avg(checkins.map((c) => c.connectionScore)),
      communication: avg(checkins.map((c) => c.communicationScore)),
      affection: avg(checkins.map((c) => c.affectionScore)),
      partnership: avg(checkins.map((c) => c.partnershipScore)),
      emotional: avg(checkins.map((c) => c.emotionalScore)),
    };
    const pairs: [string, number][] = [];
    if (stats.connection != null) pairs.push(['conexão', stats.connection]);
    if (stats.communication != null) pairs.push(['comunicação', stats.communication]);
    if (stats.affection != null) pairs.push(['carinho', stats.affection]);
    if (stats.partnership != null) pairs.push(['parceria', stats.partnership]);
    if (stats.emotional != null) pairs.push(['emocional', stats.emotional]);
    if (pairs.length > 0) {
      const summary = pairs.map(([k, v]) => `${k} ${v}/5`).join(', ');
      lines.push(`- Média dos check-ins (últimos 14 dias): ${summary}.`);
      const low = pairs.filter(([, v]) => v <= 2.5).map(([k]) => k);
      if (low.length > 0) {
        lines.push(`- Áreas que têm sido difíceis pra ela: ${low.join(', ')}.`);
      }
    }
  }

  if (agreements.length > 0) {
    lines.push('- Acordos ativos do casal:');
    for (const a of agreements.slice(0, 5)) {
      lines.push(`  • ${a.title}`);
    }
  }

  lines.push(
    '- USE esses dados só quando fizer sentido pra ela sentir escuta. NUNCA "leia a ficha" pra ela ("vejo aqui que..."). NÃO invente dados que não estão aqui.',
  );

  return lines.join('\n');
}
