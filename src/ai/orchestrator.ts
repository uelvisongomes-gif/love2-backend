import { prisma } from '../db/client.js';
import { loadConfig } from '../config.js';
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

const STYLE_RULES = [
  'ESTILO — MUITO IMPORTANTE:',
  '- Seja BREVE. Respostas curtas, no máximo 2-3 frases por resposta.',
  '- Fale como conversa de amiga, não como texto formal. Sem introdução, sem retórica.',
  '- Nada de "que interessante", "entendo você", "isso faz sentido" — vai direto no ponto.',
  '- Uma pergunta ou uma sugestão por vez. Nada de listas longas ou parágrafos.',
  '- Se for oferecer opções, no máximo 2 curtas.',
].join('\n');

const BASE_IDENTITY_FIRST = [
  'Você é LOVE, mediadora do aplicativo love2.',
  'É a PRIMEIRA mensagem dessa pessoa nesse contexto. Comece se apresentando em UMA linha só e lembre que você NÃO é psicóloga, terapeuta ou médica. Nada mais que isso na apresentação.',
  'Tom: acolhedor, calmo, direto. Nunca julgue, nunca acuse.',
  'Nunca dê diagnóstico. Nunca sugira separação (exceto risco à vida).',
  'Sugere opções curtas; não decide pelo usuário.',
  'Se citar dados, cite a fonte fornecida no contexto abaixo. Sem fonte, sem número.',
  STYLE_RULES,
].join('\n');

const BASE_IDENTITY_ONGOING = [
  'Você é LOVE, mediadora do aplicativo love2.',
  'Essa pessoa JÁ conversou com você antes. NÃO se apresente, NÃO repita disclaimer — siga a conversa direto.',
  'Tom: acolhedor, calmo, direto. Nunca julgue, nunca acuse.',
  'Nunca dê diagnóstico. Nunca sugira separação (exceto risco à vida).',
  'Sugere opções curtas; não decide pelo usuário.',
  'Se citar dados, cite a fonte fornecida no contexto abaixo. Sem fonte, sem número.',
  STYLE_RULES,
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
  isFirstMessage: boolean,
): string {
  const topics = allowedTopics
    ? Object.entries(TOPICS_META)
        .filter(([k]) => allowedTopics.includes(k))
        .map(([, v]) => v)
    : Object.values(TOPICS_META);
  return [
    isFirstMessage ? BASE_IDENTITY_FIRST : BASE_IDENTITY_ONGOING,
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

  // Carrega histórico recente do usuário nesse contexto (últimas 20 msgs) — do mais antigo pro mais novo
  const priorMessages = await prisma.loveMessage.findMany({
    where: { userId: input.userId, context: input.context, role: { in: ['user', 'assistant'] } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { role: true, content: true },
  });
  const history = priorMessages.reverse();
  const isFirstMessage = history.length === 0;

  const system = buildSystemPrompt(input.context, input.allowedTopics, ragBlock, isFirstMessage);
  const messages: LlmMessage[] = [
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: input.content },
  ];
  // Haiku 4.5 pra chat casual — 2-3x mais rápido que Opus, qualidade ok pra diálogo.
  // Limite baixo de output pra forçar respostas curtas.
  const cfg = loadConfig();
  const llmResult = await getLlmProvider().complete(messages, {
    system,
    maxTokens: 400,
    model: cfg.LLM_MODEL_LIGHT,
  });

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
      citations: citations.length ? (citations as unknown as object) : undefined,
    },
    select: { id: true },
  });

  return { reply: llmResult.text, safety, citations, messageId: asst.id };
}

export { formatCitation };
