import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { getLlmProvider } from '../../ai/llm.js';
import { loadConfig } from '../../config.js';
import { sendWhatsApp } from '../wame/service.js';

const MODERATOR_SYSTEM = (
  aName: string,
  bName: string,
  aGender: string | null,
  bGender: string | null,
): string => {
  const trata = (g: string | null): string =>
    g === 'homem' ? 'ele' : g === 'mulher' ? 'ela' : 'ele/ela';
  return [
    `Você é a LOVE, mediadora do love2. Está numa sala de mediação com um casal: ${aName} e ${bName}.`,
    `${aName} usa pronome "${trata(aGender)}". ${bName} usa pronome "${trata(bGender)}".`,
    '',
    'PRINCÍPIOS:',
    '- Você é neutra. Não toma partido. Nunca acusa.',
    '- Cria um espaço seguro: sem ofensa, sem palavrão, sem interrupção.',
    '- Não é psicóloga nem terapeuta — é mediadora.',
    '- Nunca sugere separação (exceto risco à vida).',
    '- Nunca diagnostica transtornos.',
    '',
    'ESTILO:',
    '- Respostas de 2 a 8 frases. Objetiva, calma.',
    '- Fala com os dois usando os nomes.',
    '- Faz 1 pergunta ou 1 pedido de reflexão por vez.',
    '- Alterna atenção entre os dois pra ambos falarem.',
    '',
    'FLUXO DA SESSÃO (siga em ORDEM):',
    '1) ABERTURA (só na PRIMEIRA mensagem sua):',
    `   "${aName} e ${bName}, vocês são um casal e é natural surgirem desavenças, conflitos, diferenças de opinião - isso faz parte. O que não pode fazer parte é carregar mágoa, é não resolver, é não procurar ajuda.`,
    '   Em uma relação não existe 1 que é 100% certo e nem 1 que é 100% errado. Pra nossa conversa ser produtiva, é importante que ambos abaixem a guarda pra gente resolver isso.',
    `   Combinamos algumas regras: sem ofensa, sem palavrão, cada um tem seu espaço e tempo de fala sem julgamento. Podem topar?`,
    `   ${aName}, pode ser? ${bName}, pode ser?"`,
    '',
    '2) ESCUTA DE CADA UM: pede pra um falar primeiro, escuta, sintetiza brevemente ("então o que você tá dizendo é..."), depois passa a palavra pro outro. Nunca deixa o outro cortar.',
    '',
    '3) DIAGNÓSTICO CONJUNTO: quando ambos falaram, apresenta o que ouviu em 2-3 frases, mostrando que cada um tem uma dor legítima.',
    '',
    '4) PROPOSTA DE ACORDO: propõe algo prático que atende as necessidades dos dois. Uma frase clara. Pergunta se topam.',
    '',
    '5) FECHAMENTO: quando ambos concordam, valida e diz que a próxima conversa é ainda mais fácil.',
    '',
    'REGRAS DE INTERVENÇÃO:',
    '- Se detectar ofensa, palavrão, ou tom agressivo: interrompe com calma. "Vamos respirar. Aqui a gente não usa esse tom. Retomando..."',
    '- Se um interrompe o outro: "Um de cada vez. [nome do outro] tava falando."',
    '- Se um se cala: puxa gentilmente. "[nome], o que você acha disso?"',
    '',
    'QUANDO propor acordo, termina a resposta com a tag:',
    '  <acordo>frase única, imperativa, direta ao ponto — no MÁXIMO 15 palavras</acordo>',
    'Só use essa tag na ETAPA 4.',
  ].join('\n');
};

interface UserInfo {
  id: string;
  name: string;
  gender: string | null;
}

async function getCoupleForUser(userId: string): Promise<{
  coupleId: string;
  userA: UserInfo;
  userB: UserInfo;
} | null> {
  const couple = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true, userAId: true, userBId: true },
  });
  if (!couple) return null;
  const [aUser, bUser, aProfile, bProfile] = await Promise.all([
    prisma.user.findUnique({ where: { id: couple.userAId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: couple.userBId }, select: { name: true } }),
    prisma.profile.findUnique({ where: { userId: couple.userAId }, select: { gender: true } }),
    prisma.profile.findUnique({ where: { userId: couple.userBId }, select: { gender: true } }),
  ]);
  return {
    coupleId: couple.id,
    userA: { id: couple.userAId, name: aUser?.name ?? 'Parceiro A', gender: aProfile?.gender ?? null },
    userB: { id: couple.userBId, name: bUser?.name ?? 'Parceiro B', gender: bProfile?.gender ?? null },
  };
}

export async function createSession(userId: string, topic: string | undefined) {
  const couple = await getCoupleForUser(userId);
  if (!couple) throw new AppError('NO_COUPLE', 'Vincule seu parceiro primeiro', 403);
  const session = await prisma.liveMediation.create({
    data: {
      coupleId: couple.coupleId,
      initiatorId: userId,
      topic: topic ?? null,
    },
  });
  // Avisa o parceiro via WhatsApp se linkado
  const partnerId = couple.userA.id === userId ? couple.userB.id : couple.userA.id;
  const partnerName = couple.userA.id === userId ? couple.userB.name : couple.userA.name;
  const myName = couple.userA.id === userId ? couple.userA.name : couple.userB.name;
  const partnerLink = await prisma.userPhoneLink.findUnique({ where: { userId: partnerId } });
  if (partnerLink) {
    const cfg = loadConfig();
    const url = `${cfg.APP_URL}/mediacao/live/${session.id}`;
    void sendWhatsApp(
      partnerLink.phoneE164,
      `Olá ${partnerName}! Sou a LOVE. ${myName} pediu pra a gente ter uma conversa juntos, os 3, pra resolver algo importante entre vocês.\n\nAbre esse link quando puder pra a gente começar:\n${url}`,
    );
  }
  return { sessionId: session.id };
}

export async function getSession(userId: string, sessionId: string, since?: string) {
  const session = await prisma.liveMediation.findUnique({
    where: { id: sessionId },
  });
  if (!session) throw new AppError('NOT_FOUND', 'Sessão não encontrada', 404);
  // Só permite acesso a membros do casal
  const couple = await prisma.couple.findUnique({
    where: { id: session.coupleId },
    select: { userAId: true, userBId: true },
  });
  if (!couple || (couple.userAId !== userId && couple.userBId !== userId)) {
    throw new AppError('FORBIDDEN', 'Você não faz parte dessa mediação', 403);
  }
  const messages = await prisma.liveMediationMessage.findMany({
    where: {
      sessionId,
      ...(since ? { createdAt: { gt: new Date(since) } } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  const [aUser, bUser] = await Promise.all([
    prisma.user.findUnique({ where: { id: couple.userAId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: couple.userBId }, select: { name: true } }),
  ]);
  return {
    session: {
      id: session.id,
      status: session.status,
      topic: session.topic,
      userA: { id: couple.userAId, name: aUser?.name ?? 'A' },
      userB: { id: couple.userBId, name: bUser?.name ?? 'B' },
    },
    messages: messages.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

export async function sendMessage(userId: string, sessionId: string, content: string) {
  const session = await prisma.liveMediation.findUnique({ where: { id: sessionId } });
  if (!session) throw new AppError('NOT_FOUND', 'Sessão não encontrada', 404);
  const couple = await prisma.couple.findUnique({
    where: { id: session.coupleId },
    select: { userAId: true, userBId: true },
  });
  if (!couple || (couple.userAId !== userId && couple.userBId !== userId)) {
    throw new AppError('FORBIDDEN', 'Você não faz parte dessa mediação', 403);
  }
  if (session.status === 'ended' || session.status === 'canceled') {
    throw new AppError('SESSION_ENDED', 'Essa sessão já terminou', 400);
  }

  // Se estava waiting_partner e o parceiro entrou agora, ativa
  const isPartner = session.initiatorId !== userId;
  if (session.status === 'waiting_partner' && isPartner) {
    await prisma.liveMediation.update({
      where: { id: sessionId },
      data: { status: 'active' },
    });
  }

  await prisma.liveMediationMessage.create({
    data: { sessionId, senderId: userId, content },
  });

  // Fire-and-forget: gera resposta da LOVE
  void moderateResponse(sessionId);
  return { ok: true };
}

const AGREEMENT_TAG_REGEX = /<acordo>([\s\S]*?)<\/acordo>/i;

async function moderateResponse(sessionId: string): Promise<void> {
  try {
    const session = await prisma.liveMediation.findUnique({ where: { id: sessionId } });
    if (!session || session.status === 'ended') return;

    const couple = await getCoupleForUser(session.initiatorId);
    if (!couple) return;

    const messages = await prisma.liveMediationMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: 60,
    });

    // Constrói histórico como sequência de user turns rotulados
    const historyText = messages
      .map((m) => {
        if (m.senderId === null) return `LOVE: ${m.content}`;
        const name = m.senderId === couple.userA.id ? couple.userA.name : couple.userB.name;
        return `${name}: ${m.content}`;
      })
      .join('\n');

    const system = MODERATOR_SYSTEM(
      couple.userA.name,
      couple.userB.name,
      couple.userA.gender,
      couple.userB.gender,
    );

    const cfg = loadConfig();
    const llm = getLlmProvider();
    const result = await llm.complete(
      [
        {
          role: 'user',
          content:
            historyText +
            '\n\nAgora é sua vez, LOVE. Responda seguindo o fluxo. Responda apenas o que você diria — sem prefixos tipo "LOVE:".',
        },
      ],
      { system, maxTokens: 500, model: cfg.LLM_MODEL_LIGHT },
    );

    let text = result.text.trim();
    const agreementMatch = text.match(AGREEMENT_TAG_REGEX);
    if (agreementMatch) {
      const agreement = agreementMatch[1]?.trim() ?? '';
      text = text.replace(AGREEMENT_TAG_REGEX, '').trim();
      // Registra o acordo proposto — usuário pode aceitar em frontend depois
      await prisma.agreement.create({
        data: {
          coupleId: session.coupleId,
          createdBy: session.initiatorId,
          title: session.topic ?? 'Acordo da mediação',
          content: agreement,
          status: 'em_andamento',
        },
      });
    }

    if (text.length > 0) {
      await prisma.liveMediationMessage.create({
        data: { sessionId, senderId: null, content: text },
      });
    }
  } catch (err) {
    console.error('[livemediation] moderateResponse failed', err);
  }
}

export async function endSession(userId: string, sessionId: string) {
  const session = await prisma.liveMediation.findUnique({ where: { id: sessionId } });
  if (!session) throw new AppError('NOT_FOUND', 'Sessão não encontrada', 404);
  const couple = await prisma.couple.findUnique({
    where: { id: session.coupleId },
    select: { userAId: true, userBId: true },
  });
  if (!couple || (couple.userAId !== userId && couple.userBId !== userId)) {
    throw new AppError('FORBIDDEN', 'Você não faz parte dessa mediação', 403);
  }
  await prisma.liveMediation.update({
    where: { id: sessionId },
    data: { status: 'ended', endedAt: new Date() },
  });
  return { ok: true };
}
