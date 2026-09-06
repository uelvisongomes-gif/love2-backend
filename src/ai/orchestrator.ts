import { prisma } from '../db/client.js';
import { getLlmProvider, type LlmMessage } from './llm.js';
import { formatCitation, searchRag } from './rag.js';
import { assessMessage, SAFETY_EMERGENCY_MESSAGE, type SafetyFinding } from './safety.js';

export type ChatContext = 'general' | 'check-in' | 'conflict' | 'journal';

export interface ChatInput {
  userId: string;
  content: string;
  context: ChatContext;
  allowedTopics?: string[];
}

export interface ChatCitation {
  title: string;
  url: string;
}

export interface ChatResult {
  reply: string;
  safety: SafetyFinding;
  citations: ChatCitation[];
  messageId: string;
}

const BASE_IDENTITY = [
  'Você é LOVE, mediadora do aplicativo LOVE Casal.',
  'Você NÃO é psicóloga, terapeuta ou médica — deixe isso claro no início de conversas novas.',
  'Tom: acolhedor, calmo, consultivo. Nunca julgue, nunca acuse.',
  'Nunca dê diagnóstico. Nunca sugira separação (exceto risco à vida).',
  'Sugere opções; não decide pelo usuário. Deixe claro que a decisão é dele/dela.',
  'Se citar dados ou estatísticas, cite a fonte fornecida no contexto abaixo.',
  'Se não houver fonte no contexto para uma estatística, NÃO invente — reformule sem número.',
].join('\n');

const TOPICS_META: Record<string, string> = {
  financeiro: 'Você pode abordar o pilar Financeiro.',
  comunicacao: 'Você pode abordar o pilar Comunicação.',
  intimidade: 'Você pode abordar o pilar Vida Íntima com cuidado.',
  filhos: 'Você pode abordar o pilar Filhos e criação.',
  tarefas: 'Você pode abordar o pilar Divisão de Tarefas.',
  papeis: 'Você pode abordar o pilar Papéis no relacionamento.',
  espiritualidade: 'Você pode abordar o pilar Espiritualidade se pertinente.',
};

function buildSystemPrompt(
  context: ChatContext,
  allowedTopics: string[] | undefined,
  ragBlock: string,
): string {
  const topics = allowedTopics
    ? Object.entries(TOPICS_META)
        .filter(([k]) => allowedTopics.includes(k))
        .map(([, v]) => v)
    : Object.values(TOPICS_META);
  return [
    BASE_IDENTITY,
    '',
    `Contexto da conversa: ${context}.`,
    '',
    'Pilares que você pode abordar:',
    ...topics.map((t) => `- ${t}`),
    '',
    ragBlock,
  ].join('\n');
}

export async function chatWithLove(input: ChatInput): Promise<ChatResult> {
  const safety = await assessMessage(input.content);
  await prisma.loveMessage.create({
    data: {
      userId: input.userId,
      context: input.context,
      role: 'user',
      content: input.content,
      safetyCategory: safety.category === 'safe' ? null : safety.category,
    },
  });

  if (safety.category !== 'safe') {
    const asst = await prisma.loveMessage.create({
      data: {
        userId: input.userId,
        context: input.context,
        role: 'assistant',
        content: SAFETY_EMERGENCY_MESSAGE,
        safetyCategory: safety.category,
      },
      select: { id: true },
    });
    return { reply: SAFETY_EMERGENCY_MESSAGE, safety, citations: [], messageId: asst.id };
  }

  const hits = await searchRag(input.content, { k: 3 });
  const ragBlock = hits.length
    ? [
        'Fontes recuperadas (use ao menos uma se afirmar algo específico):',
        ...hits.map((h, i) => `[${i + 1}] ${h.source.title} — ${h.source.url}\n${h.source.content}`),
      ].join('\n\n')
    : 'Nenhuma fonte específica foi recuperada para este turno.';

  const system = buildSystemPrompt(input.context, input.allowedTopics, ragBlock);
  const messages: LlmMessage[] = [{ role: 'user', content: input.content }];
  const llmResult = await getLlmProvider().complete(messages, { system });

  const citations: ChatCitation[] = hits.map((h) => ({
    title: h.source.title,
    url: h.source.url,
  }));

  const asst = await prisma.loveMessage.create({
    data: {
      userId: input.userId,
      context: input.context,
      role: 'assistant',
      content: llmResult.text,
      citations: citations.length ? citations : undefined,
    },
    select: { id: true },
  });

  return { reply: llmResult.text, safety, citations, messageId: asst.id };
}

export { formatCitation };
