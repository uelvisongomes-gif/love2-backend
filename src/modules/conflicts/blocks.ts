import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { getLlmProvider, type LlmMessage } from '../../ai/llm.js';

const BLOCK_GEN_SYSTEM = [
  'Você é LOVE, mediadora do LOVE Casal. Você NÃO é psicóloga nem terapeuta.',
  '',
  'Sua tarefa agora: leia a conversa abaixo entre você e a pessoa A, e produza',
  'entre 3 e 6 blocos de resumo que poderão ser mostrados ao parceiro B, SE A autorizar.',
  '',
  'Regras absolutas para cada bloco:',
  '1. Fatual: descreva o que aconteceu, quando, onde — sem interpretar motivação.',
  '2. Em Comunicação Não-Violenta: converta acusações em observação + sentimento + necessidade.',
  '   Ex: "ele é controlador" -> "senti que preciso de mais autonomia sobre pequenas decisões".',
  '3. Fala em primeira pessoa (do ponto de vista de A).',
  '4. NUNCA use adjetivos que definem o outro ("controlador", "egoísta", "irresponsável").',
  '5. Cada bloco tem 1 a 3 frases, no máximo.',
  '',
  'Responda APENAS com um array JSON de strings, sem texto antes ou depois.',
  'Exemplo: ["bloco 1", "bloco 2", "bloco 3"]',
].join('\n');

export interface BlockRow {
  id: string;
  order: number;
  content: string;
  status: 'proposed' | 'approved' | 'edited' | 'removed';
  createdAt: Date;
  updatedAt: Date;
}

export const updateBlockInput = z.discriminatedUnion('status', [
  z.object({ status: z.literal('approved') }).strict(),
  z.object({ status: z.literal('removed') }).strict(),
  z.object({ status: z.literal('edited'), content: z.string().min(1).max(1000) }).strict(),
]);
export type UpdateBlockInput = z.infer<typeof updateBlockInput>;

async function assertInitiator(userId: string, conflictId: string) {
  const c = await prisma.conflict.findUnique({ where: { id: conflictId } });
  if (!c) throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  if (c.initiatorId !== userId) throw new AppError('NOT_INITIATOR', 'Apenas quem abriu o conflito pode fazer isso', 403);
  return c;
}

function tryParseBlocks(text: string): string[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('LLM did not return a JSON array');
  const parsed: unknown = JSON.parse(match[0]);
  if (!Array.isArray(parsed) || !parsed.every((s) => typeof s === 'string')) {
    throw new Error('LLM did not return an array of strings');
  }
  return parsed;
}

export async function generateBlocks(userId: string, conflictId: string): Promise<{ blocks: BlockRow[] }> {
  await assertInitiator(userId, conflictId);

  const history = await prisma.conflictMessage.findMany({
    where: { conflictId, side: 'A' },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  });
  if (history.length === 0) {
    throw new AppError('NO_HISTORY', 'Converse primeiro com a LOVE antes de gerar blocos', 400);
  }

  const messages: LlmMessage[] = history.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));
  // Claude Opus 5 rejects conversations that end with an assistant message
  // (prefill removed). Append a synthetic user turn asking for the blocks.
  messages.push({
    role: 'user',
    content: 'Agora, com base na conversa acima, gere o array JSON de blocos conforme instruído.',
  });
  const llm = await getLlmProvider().complete(messages, { system: BLOCK_GEN_SYSTEM, maxTokens: 1500 });

  let contents: string[];
  try {
    contents = tryParseBlocks(llm.text);
  } catch (e) {
    throw new AppError('BLOCK_GEN_FAILED', `Não consegui gerar os blocos agora: ${(e as Error).message}`, 500);
  }
  if (contents.length < 1 || contents.length > 8) {
    throw new AppError('BLOCK_GEN_INVALID_COUNT', `LOVE retornou ${contents.length} blocos (esperado 1–8)`, 500);
  }

  return prisma.$transaction(async (tx) => {
    await tx.conflictBlock.deleteMany({ where: { conflictId, status: 'proposed' } });
    const created: BlockRow[] = [];
    for (let i = 0; i < contents.length; i++) {
      const row = await tx.conflictBlock.create({
        data: { conflictId, order: i, content: contents[i], status: 'proposed' },
      });
      created.push(row as BlockRow);
    }
    await tx.conflict.update({ where: { id: conflictId }, data: { status: 'blocks_pending' } });
    return { blocks: created };
  });
}

export async function listBlocks(userId: string, conflictId: string): Promise<{ blocks: BlockRow[] }> {
  await assertInitiator(userId, conflictId);
  const blocks = (await prisma.conflictBlock.findMany({
    where: { conflictId },
    orderBy: { order: 'asc' },
  })) as BlockRow[];
  return { blocks };
}

export async function updateBlock(
  userId: string,
  conflictId: string,
  blockId: string,
  input: UpdateBlockInput,
): Promise<BlockRow> {
  await assertInitiator(userId, conflictId);
  const block = await prisma.conflictBlock.findFirst({ where: { id: blockId, conflictId } });
  if (!block) throw new AppError('NOT_FOUND', 'Bloco não encontrado', 404);
  const data: { status: string; content?: string } = { status: input.status };
  if (input.status === 'edited') data.content = input.content;
  const updated = (await prisma.conflictBlock.update({ where: { id: blockId }, data })) as BlockRow;
  return updated;
}

export async function authorizedBlocks(conflictId: string): Promise<BlockRow[]> {
  return (await prisma.conflictBlock.findMany({
    where: { conflictId, status: { in: ['approved', 'edited'] } },
    orderBy: { order: 'asc' },
  })) as BlockRow[];
}
