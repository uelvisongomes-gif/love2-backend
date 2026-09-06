import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { getLlmProvider, type LlmMessage } from '../../ai/llm.js';
import { careModeActive } from '../profile/safety-screening.js';
import { authorizedBlocks } from './blocks.js';
import type { ConflictStatus } from './schema.js';

const CARE_MODE_MESSAGE = [
  'Percebi (por informações da triagem de segurança) que existe uma vulnerabilidade nesta relação que pede cuidado especial.',
  'A mediação por blocos entre parceiros NÃO é o caminho seguro aqui.',
  '',
  'Por favor, procure apoio especializado antes de qualquer conversa mediada:',
  '• CVV — Centro de Valorização da Vida: 188 (24h, gratuito)',
  '• Ligue 180 — Central de Atendimento à Mulher (24h)',
  '• Um(a) psicólogo(a) ou terapeuta de casal presencial',
].join('\n');

const B_APPROACH_SYSTEM = [
  'Você é LOVE, mediadora do LOVE Casal. Você NÃO é psicóloga nem terapeuta.',
  '',
  'Sua tarefa: escrever UMA mensagem curta para a pessoa B abrindo uma conversa.',
  'A pessoa A conversou com você e autorizou os blocos abaixo a serem compartilhados.',
  '',
  'Regras absolutas:',
  '1. Tom consultivo, acolhedor. NUNCA acusatório.',
  '2. NÃO diga "A disse que você é X" — apresente como perspectiva de A, não julgamento sobre B.',
  '3. Convide B a compartilhar a perspectiva dele/dela, sem pressão.',
  '4. Deixe claro que é opcional aceitar essa conversa.',
  '5. NÃO cite estatísticas nem estudos aqui — esta é uma mensagem de abertura, não análise.',
  '6. Máximo 4 parágrafos curtos.',
].join('\n');

export const ponteRespondInput = z.object({ accept: z.boolean() }).strict();
export type PonteRespondInput = z.infer<typeof ponteRespondInput>;

async function assertInitiator(userId: string, conflictId: string) {
  const c = await prisma.conflict.findUnique({ where: { id: conflictId } });
  if (!c) throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  if (c.initiatorId !== userId) throw new AppError('NOT_INITIATOR', 'Apenas quem abriu pode fazer isso', 403);
  return c;
}

async function assertTarget(userId: string, conflictId: string) {
  const c = await prisma.conflict.findUnique({ where: { id: conflictId } });
  if (!c) throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  if (c.targetId !== userId) throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  return c;
}

export async function openPonte(userId: string, conflictId: string) {
  const conflict = await assertInitiator(userId, conflictId);
  if (conflict.status !== 'blocks_pending') {
    throw new AppError('WRONG_STATUS', `Ponte só pode ser aberta em blocks_pending (atual: ${conflict.status})`, 400);
  }
  const blocks = await authorizedBlocks(conflictId);
  if (blocks.length === 0) {
    throw new AppError('NO_APPROVED_BLOCKS', 'Aprove ao menos um bloco antes de abrir a ponte', 400);
  }

  const [aCare, bCare] = await Promise.all([
    careModeActive(conflict.initiatorId),
    careModeActive(conflict.targetId),
  ]);
  if (aCare || bCare) {
    throw new AppError('CARE_MODE_ACTIVE', CARE_MODE_MESSAGE, 403);
  }

  const blocksText = blocks.map((b, i) => `[${i + 1}] ${b.content}`).join('\n');
  const messages: LlmMessage[] = [
    {
      role: 'user',
      content: `Aqui estão os blocos autorizados pela pessoa A:\n\n${blocksText}\n\nEscreva agora sua mensagem para a pessoa B.`,
    },
  ];
  const llm = await getLlmProvider().complete(messages, { system: B_APPROACH_SYSTEM, maxTokens: 800 });

  return prisma.$transaction(async (tx) => {
    await tx.conflictMessage.create({
      data: {
        conflictId,
        side: 'B',
        authorId: conflict.targetId,
        role: 'assistant',
        content: llm.text,
      },
    });
    return tx.conflict.update({ where: { id: conflictId }, data: { status: 'ponte_invited' } });
  });
}

export async function respondPonte(userId: string, conflictId: string, input: PonteRespondInput) {
  const conflict = await assertTarget(userId, conflictId);
  if (conflict.status !== 'ponte_invited') {
    throw new AppError('WRONG_STATUS', 'Nada pendente pra responder aqui', 400);
  }
  const nextStatus: ConflictStatus = input.accept ? 'collecting_b' : 'ponte_declined';
  return prisma.conflict.update({ where: { id: conflictId }, data: { status: nextStatus } });
}

export async function getAuthorizedSummary(userId: string, conflictId: string) {
  const conflict = await assertTarget(userId, conflictId);
  const opened: readonly ConflictStatus[] = [
    'ponte_invited',
    'ponte_accepted',
    'collecting_b',
    'cross_referenced',
    'closed',
  ];
  if (!opened.includes(conflict.status as ConflictStatus)) {
    throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  }
  const blocks = await authorizedBlocks(conflictId);
  return { blocks: blocks.map((b) => ({ order: b.order, content: b.content })) };
}
