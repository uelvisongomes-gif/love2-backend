import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { getLlmProvider, type LlmMessage } from '../../ai/llm.js';
import type { ConflictStatus } from './schema.js';

const CROSS_REF_SYSTEM = [
  'Você é LOVE, mediadora do love2. NÃO é psicóloga nem terapeuta.',
  '',
  'Você tem acesso à conversa que teve com A e à conversa que teve com B sobre o MESMO conflito.',
  'Sua tarefa: fazer um cruzamento e devolver um JSON com quatro chaves:',
  '',
  '- "commonGround": 1-3 frases sobre pontos onde A e B parecem concordar (ou compartilhar preocupação).',
  '- "patterns": array de 1-4 padrões observados na interação (ex: "ambos falam sobre segurança financeira sob rótulos diferentes").',
  '- "aInsight": mensagem PRIVADA para A (1-3 parágrafos, tom acolhedor, sem citar frases literais de B, sem julgamento).',
  '- "bInsight": mensagem PRIVADA para B (idem).',
  '',
  'Regras absolutas:',
  '1. Cada insight fala com um dos dois — nunca revele frases da conversa privada do outro.',
  '2. NÃO tome partido. NÃO diga quem está "certo".',
  '3. Fale em opções e observações, nunca em ordens.',
  '4. NÃO cite estatísticas nem estudos aqui.',
  '5. Responda APENAS com o JSON. Nada antes ou depois.',
].join('\n');

async function assertInitiator(userId: string, conflictId: string) {
  const c = await prisma.conflict.findUnique({ where: { id: conflictId } });
  if (!c) throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  if (c.initiatorId !== userId) throw new AppError('NOT_INITIATOR', 'Apenas quem abriu pode fazer isso', 403);
  return c;
}
async function assertParticipant(userId: string, conflictId: string) {
  const c = await prisma.conflict.findUnique({ where: { id: conflictId } });
  if (!c) throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  if (c.initiatorId !== userId && c.targetId !== userId) {
    throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  }
  return c;
}

function tryParseCross(text: string): { commonGround: string; patterns: string[]; aInsight: string; bInsight: string } {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM did not return an object');
  const obj: unknown = JSON.parse(match[0]);
  const o = obj as Record<string, unknown>;
  if (
    typeof o.commonGround !== 'string' ||
    !Array.isArray(o.patterns) ||
    !o.patterns.every((p) => typeof p === 'string') ||
    typeof o.aInsight !== 'string' ||
    typeof o.bInsight !== 'string'
  ) {
    throw new Error('LLM returned object of wrong shape');
  }
  return {
    commonGround: o.commonGround,
    patterns: o.patterns as string[],
    aInsight: o.aInsight,
    bInsight: o.bInsight,
  };
}

export async function crossReference(userId: string, conflictId: string) {
  const conflict = await assertInitiator(userId, conflictId);
  if (conflict.status !== 'collecting_b') {
    throw new AppError(
      'WRONG_STATUS',
      `Cruzamento só pode acontecer em collecting_b (atual: ${conflict.status})`,
      400,
    );
  }
  const aMsgs = await prisma.conflictMessage.findMany({
    where: { conflictId, side: 'A' },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  });
  const bMsgs = await prisma.conflictMessage.findMany({
    where: { conflictId, side: 'B' },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  });
  const bUserMsgs = bMsgs.filter((m) => m.role === 'user');
  if (bUserMsgs.length === 0) {
    throw new AppError('B_HAS_NOT_SPOKEN', 'B ainda não compartilhou nada — aguarde.', 400);
  }

  const transcript = [
    '=== Conversa com A ===',
    ...aMsgs.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
    '',
    '=== Conversa com B ===',
    ...bMsgs.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
  ].join('\n');

  const messages: LlmMessage[] = [{ role: 'user', content: transcript }];
  const llm = await getLlmProvider().complete(messages, { system: CROSS_REF_SYSTEM, maxTokens: 2000 });

  let parsed: { commonGround: string; patterns: string[]; aInsight: string; bInsight: string };
  try {
    parsed = tryParseCross(llm.text);
  } catch (e) {
    throw new AppError('CROSSREF_PARSE_FAILED', `Cruzamento falhou: ${(e as Error).message}`, 500);
  }

  return prisma.$transaction(async (tx) => {
    await tx.conflictMessage.create({
      data: {
        conflictId,
        side: 'A',
        authorId: conflict.initiatorId,
        role: 'assistant',
        content: parsed.aInsight,
      },
    });
    await tx.conflictMessage.create({
      data: {
        conflictId,
        side: 'B',
        authorId: conflict.targetId,
        role: 'assistant',
        content: parsed.bInsight,
      },
    });
    await tx.conflict.update({ where: { id: conflictId }, data: { status: 'cross_referenced' } });
    return {
      commonGround: parsed.commonGround,
      patterns: parsed.patterns,
      mySideInsight: parsed.aInsight,
    };
  });
}

export async function getInsight(userId: string, conflictId: string) {
  const conflict = await assertParticipant(userId, conflictId);
  const okStatuses: readonly ConflictStatus[] = ['cross_referenced', 'closed'];
  if (!okStatuses.includes(conflict.status as ConflictStatus)) {
    throw new AppError('NOT_YET', 'Ainda não há insight cruzado neste conflito', 400);
  }
  const side = conflict.initiatorId === userId ? 'A' : 'B';
  const insight = await prisma.conflictMessage.findFirst({
    where: { conflictId, side, role: 'assistant' },
    orderBy: { createdAt: 'desc' },
    select: { content: true, createdAt: true },
  });
  if (!insight) throw new AppError('NOT_YET', 'Ainda não há insight cruzado', 400);
  return { insight: insight.content, at: insight.createdAt };
}
