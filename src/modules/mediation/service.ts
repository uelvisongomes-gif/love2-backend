import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { getEmailSender } from '../auth/email.js';
import { getLlmProvider } from '../../ai/llm.js';
import { loadConfig } from '../../config.js';

export const MEDIATION_STEPS = ['fatos', 'sentimento', 'necessidade', 'ponto_do_outro'] as const;
export type MediationStepName = (typeof MEDIATION_STEPS)[number];

export const STEP_QUESTIONS: Record<MediationStepName, string> = {
  fatos: 'Me conta o que aconteceu, do seu jeito. Só os fatos, sem se preocupar em decidir quem tá certo.',
  sentimento: 'E como você se sentiu com isso? Foi frustração, insegurança, sobrecarga, outra coisa?',
  necessidade: 'O que você precisava ali? Se pudesse mudar algo, o que gostaria que tivesse acontecido?',
  ponto_do_outro: 'Como você imagina que ele/ela viveu essa mesma situação? O que ele/ela pode ter precisado?',
};

export async function createSession(userId: string, topic: string | undefined) {
  const couple = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true, userAId: true, userBId: true },
  });
  if (!couple) throw new AppError('NO_COUPLE', 'Vincule seu parceiro primeiro', 403);
  const targetId = couple.userAId === userId ? couple.userBId : couple.userAId;
  const session = await prisma.mediationSession.create({
    data: {
      coupleId: couple.id,
      initiatorId: userId,
      targetId,
      topic: topic ?? null,
    },
  });
  // Manda email pro parceiro
  const [target, me] = await Promise.all([
    prisma.user.findUnique({ where: { id: targetId }, select: { email: true, name: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);
  if (target?.email) {
    const cfg = loadConfig();
    const url = `${cfg.APP_URL}/mediacao/${session.id}`;
    try {
      await getEmailSender().send(
        target.email,
        `💬 ${me?.name ?? 'Seu parceiro'} te convidou pra uma mediação no love2`,
        `Oi${target.name ? `, ${target.name}` : ''}!\n\n${me?.name ?? 'Seu parceiro'} tá querendo conversar melhor sobre algo com você — sem pressão, sem julgamento.\n\nQuando puder, entra aqui: ${url}\n\nVocês respondem 4 perguntas cada um, em privado. A LOVE junta os dois lados de forma neutra.\n\n— love2`,
        `<div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #c9694a; font-weight: 500;">💬 Um convite pra conversar</h2>
          <p style="font-size: 16px; color: #333;">Oi${target.name ? `, ${target.name}` : ''}!</p>
          <p style="font-size: 15px; color: #555; line-height: 1.6;">
            <strong>${me?.name ?? 'Seu parceiro'}</strong> começou uma mediação no love2 pra vocês conversarem melhor sobre algo — sem pressão, sem julgamento.
          </p>
          <p style="font-size: 15px; color: #555; line-height: 1.6;">
            Vocês respondem <strong>4 perguntas cada um</strong>, cada um em privado. Depois a LOVE junta os dois lados de forma neutra e sugere um combinado prático.
          </p>
          <a href="${url}" style="display: inline-block; background: #c9694a; color: white; padding: 12px 24px; border-radius: 999px; text-decoration: none; font-weight: 600; margin-top: 16px;">Abrir mediação</a>
          <p style="color: #999; font-size: 12px; margin-top: 32px;">love2 — uma mediadora, não uma terapeuta.</p>
        </div>`,
      );
    } catch (err) {
      console.log('[mediation] email invite fail:', (err as Error).message);
    }
  }
  return session;
}

export async function listSessions(userId: string) {
  const sessions = await prisma.mediationSession.findMany({
    where: { OR: [{ initiatorId: userId }, { targetId: userId }] },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  return { sessions };
}

async function loadSessionOrThrow(userId: string, id: string) {
  const s = await prisma.mediationSession.findUnique({ where: { id } });
  if (!s) throw new AppError('NOT_FOUND', 'Mediação não encontrada', 404);
  if (s.initiatorId !== userId && s.targetId !== userId) {
    throw new AppError('FORBIDDEN', 'Sem acesso a essa mediação', 403);
  }
  return s;
}

export async function getSession(userId: string, id: string) {
  const session = await loadSessionOrThrow(userId, id);
  // Traz só as etapas do usuário atual (não expõe as do parceiro se ainda não finalizou)
  const mySteps = await prisma.mediationStep.findMany({
    where: { sessionId: id, userId },
    orderBy: { submittedAt: 'asc' },
  });
  const partnerId = session.initiatorId === userId ? session.targetId : session.initiatorId;
  const partnerStepsCount = await prisma.mediationStep.count({
    where: { sessionId: id, userId: partnerId },
  });
  return {
    session,
    mySteps,
    partnerStepsCount,
    myRole: session.initiatorId === userId ? 'initiator' : 'target',
  };
}

export async function submitStep(
  userId: string,
  sessionId: string,
  step: MediationStepName,
  answer: string,
) {
  const session = await loadSessionOrThrow(userId, sessionId);
  if (session.status !== 'in_progress' && session.status !== 'ready_for_synthesis') {
    throw new AppError('BAD_STATE', 'Mediação já foi encerrada', 400);
  }
  const saved = await prisma.mediationStep.upsert({
    where: { sessionId_userId_step: { sessionId, userId, step } },
    create: { sessionId, userId, step, answer },
    update: { answer, submittedAt: new Date() },
  });
  // Verifica se ambos completaram todas as 4 etapas
  const totalSteps = await prisma.mediationStep.count({ where: { sessionId } });
  if (totalSteps >= MEDIATION_STEPS.length * 2 && session.status === 'in_progress') {
    await prisma.mediationSession.update({
      where: { id: sessionId },
      data: { status: 'ready_for_synthesis' },
    });
  }
  return saved;
}

/** Gera a síntese neutra + acordo proposto usando LOVE (Claude Haiku). */
export async function generateSynthesis(userId: string, sessionId: string) {
  const session = await loadSessionOrThrow(userId, sessionId);
  if (session.status !== 'ready_for_synthesis') {
    throw new AppError('BAD_STATE', 'Ambos precisam responder as 4 etapas primeiro', 400);
  }
  const [initiatorSteps, targetSteps] = await Promise.all([
    prisma.mediationStep.findMany({
      where: { sessionId, userId: session.initiatorId },
    }),
    prisma.mediationStep.findMany({
      where: { sessionId, userId: session.targetId },
    }),
  ]);
  const byStep = (arr: typeof initiatorSteps, name: string): string =>
    arr.find((s) => s.step === name)?.answer ?? '(não respondeu)';
  const system = [
    'Você é LOVE, mediadora do love2.',
    'Sua tarefa: ler os relatos privados dos DOIS parceiros sobre o mesmo conflito e produzir:',
    '1) SÍNTESE NEUTRA (2-3 parágrafos curtos): reconhece as duas experiências sem tomar partido. Nunca cite o texto do outro literalmente — sintetize com respeito.',
    '2) ACORDO PROPOSTO: uma frase curta, imperativa (começa com verbo no infinitivo, máx 15 palavras), começando com <acordo> e fechando com </acordo>.',
    'REGRAS: nunca julgue, nunca sugira quem tem razão, nunca invente o que ninguém disse. Se algo for grave (violência, autoagressão), pausa e sinaliza necessidade de ajuda humana.',
  ].join('\n');
  const userPrompt = [
    `TÓPICO: ${session.topic ?? '(não informado)'}`,
    '',
    'PARCEIRO A DIZ:',
    `- Fatos: ${byStep(initiatorSteps, 'fatos')}`,
    `- Sentimento: ${byStep(initiatorSteps, 'sentimento')}`,
    `- Necessidade: ${byStep(initiatorSteps, 'necessidade')}`,
    `- Visão do outro: ${byStep(initiatorSteps, 'ponto_do_outro')}`,
    '',
    'PARCEIRO B DIZ:',
    `- Fatos: ${byStep(targetSteps, 'fatos')}`,
    `- Sentimento: ${byStep(targetSteps, 'sentimento')}`,
    `- Necessidade: ${byStep(targetSteps, 'necessidade')}`,
    `- Visão do outro: ${byStep(targetSteps, 'ponto_do_outro')}`,
    '',
    'Agora escreve a síntese neutra + tag <acordo>.',
  ].join('\n');
  const cfg = loadConfig();
  const llm = await getLlmProvider().complete(
    [{ role: 'user', content: userPrompt }],
    { system, maxTokens: 600, model: cfg.LLM_MODEL_LIGHT },
  );
  const text = llm.text;
  const agreementMatch = text.match(/<acordo>([\s\S]*?)<\/acordo>/i);
  const proposedAgreement = agreementMatch?.[1]?.trim() ?? null;
  const synthesis = text.replace(/<acordo>[\s\S]*?<\/acordo>/gi, '').trim();
  return prisma.mediationSession.update({
    where: { id: sessionId },
    data: { synthesis, proposedAgreement },
  });
}

export async function acceptAgreement(
  userId: string,
  sessionId: string,
  editedTitle: string,
  editedContent: string,
) {
  const session = await loadSessionOrThrow(userId, sessionId);
  if (!session.proposedAgreement) {
    throw new AppError('BAD_STATE', 'Ainda não tem acordo proposto', 400);
  }
  const agreement = await prisma.agreement.create({
    data: {
      coupleId: session.coupleId,
      createdBy: userId,
      title: editedTitle,
      content: editedContent,
      status: 'em_andamento',
    },
  });
  return prisma.mediationSession.update({
    where: { id: sessionId },
    data: { status: 'agreed', agreementId: agreement.id },
  });
}

export async function cancelSession(userId: string, sessionId: string) {
  await loadSessionOrThrow(userId, sessionId);
  return prisma.mediationSession.update({
    where: { id: sessionId },
    data: { status: 'canceled' },
  });
}
