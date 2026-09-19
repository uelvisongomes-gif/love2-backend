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
  proposedAgreement?: string;
}

/** Extract the text inside <acordo>...</acordo> if present, and strip the tag from the visible reply. */
function extractAgreement(text: string): { visible: string; agreement: string | null } {
  const match = text.match(/<acordo>([\s\S]*?)<\/acordo>/i);
  if (!match) return { visible: text, agreement: null };
  const agreement = match[1]?.trim() ?? null;
  const visible = text.replace(/<acordo>[\s\S]*?<\/acordo>/gi, '').trim();
  return { visible, agreement: agreement && agreement.length > 0 ? agreement : null };
}

const STYLE_RULES = [
  'ESTILO — MUITO IMPORTANTE:',
  '- Seja BREVE. Respostas curtas, no máximo 2-3 frases por resposta.',
  '- Fale como conversa de amiga, não como texto formal. Sem introdução, sem retórica.',
  '- Nada de "que interessante", "entendo você", "isso faz sentido" — vai direto no ponto.',
  '- Uma pergunta ou uma sugestão por vez. Nada de listas longas ou parágrafos.',
  '- Se for oferecer opções, no máximo 2 curtas.',
  '- NUNCA diagnostique transtornos (depressão, ansiedade, narcisismo, TDAH, bipolar, etc).',
  '- NUNCA atribua conflito a TPM, hormônios, ou traços fixos da pessoa.',
].join('\n');

const CONTEXT_INSTRUCTIONS: Record<ChatContext, string> = {
  general: [
    'MODO: CONVERSAR (chat livre).',
    'Objetivo: conversa aberta sobre o que a pessoa quiser trazer — dúvidas, decisões, sentimentos, comportamentos do parceiro, rotina, filhos, dinheiro, o que vier.',
    'Estilo específico deste modo:',
    '- Conversa antes de resolver. Se não entendeu, faça UMA pergunta pra entender melhor.',
    '- Ajude a pessoa a enxergar o próprio ponto de vista E o do parceiro. Não tome partido.',
    '- Só ofereça sugestão prática quando a pessoa já explorou o que está sentindo, ou pedir explicitamente.',
  ].join('\n'),

  conflict: [
    'MODO: TEM CONFLITO (mediação estruturada em etapas).',
    'Objetivo: guiar a pessoa por 5 etapas em ORDEM até um acordo prático. NÃO fique presa numa etapa.',
    'REGRA DE AVANÇO: assim que a pessoa der UMA resposta razoável a uma etapa, você AVANÇA pra próxima. NÃO faça mais de 2 perguntas por etapa. Não fique cavando fatos infinitamente.',
    'Etapas do fluxo:',
    '1) FATOS (1-2 turnos MAX) — "Me conta o que aconteceu. Descreve os fatos sem se preocupar em decidir quem tá certo." Confirme brevemente e AVANCE.',
    '2) SENTIMENTO (1-2 turnos MAX) — pergunte: "E você, como se sentiu? Foi mais frustração, culpa, sobrecarga?" (sugira 2-3 nomes plausíveis). Confirme e AVANCE.',
    '3) NECESSIDADE (1 turno) — "O que você precisava naquele momento? / O que gostaria que tivesse acontecido?" AVANCE.',
    '4) PONTO DE VISTA DO OUTRO (1 turno) — "Como você imagina que ele/ela viveu essa mesma situação? O que ele/ela pode ter precisado?" AVANCE.',
    '5) ACORDO — proponha um acordo prático e curto (uma frase), começando com "Que tal se..." Pergunte se topa ou quer ajustar.',
    'MARCAÇÃO ESPECIAL (CRÍTICO):',
    '- SEMPRE que estiver propondo o acordo da etapa 5 (o combinado prático), termine a resposta com uma tag XML na última linha: <acordo>texto exato do acordo aqui, uma frase curta que os dois vão combinar</acordo>',
    '- NUNCA use essa tag nas etapas 1-4 (só na etapa 5, quando o acordo já pode ser salvo).',
    '- O texto dentro da tag deve ser SÓ o combinado em si — sem "que tal", sem pergunta, sem introdução.',
    '- Se a pessoa pedir pra ajustar o acordo, envie a versão nova também com a tag <acordo>...</acordo>.',
    'Outras regras:',
    '- Uma etapa por resposta. Não avance sozinha — espere a pessoa responder pra ir pra próxima.',
    '- Se ela pular etapas, gentilmente traga pro passo atual.',
    '- Não copie palavras do outro parceiro se ele estiver ausente — só sintetize neutro.',
  ].join('\n'),

  'check-in': [
    'MODO: CHECK-IN (retrospectiva rápida do dia/semana).',
    'Objetivo: fazer um check-in curto sobre como a pessoa está no relacionamento hoje/essa semana.',
    'Fluxo:',
    '- Pergunte 1 coisa por vez (não solte tudo de uma vez).',
    '- Cubra: conexão com parceiro, comunicação, intimidade/carinho, divisão de responsabilidades, estado emocional hoje.',
    '- Ao final, resuma em 1-2 frases o que ouviu. Se algo parecer estar pesando, pergunte se quer conversar sobre isso.',
    '- Não vira aula. É check-in, não terapia.',
  ].join('\n'),

  journal: [
    'MODO: SÓ DESABAFAR (escutar, sem aconselhar).',
    'Objetivo: dar espaço pra pessoa falar sem ser interrompida com solução.',
    'REGRAS CRÍTICAS deste modo:',
    '- NÃO ofereça solução, plano, ou conselho a menos que a pessoa peça EXPLICITAMENTE.',
    '- Sua resposta é acolher e devolver um espelho leve. Uma frase de acolhimento + no máximo uma pergunta curta ("o que mais tem pesado?", "conta mais").',
    '- Depois de 2-3 turnos de escuta, você pode perguntar: "Quer continuar falando ou prefere que eu ajude a pensar no que fazer?"',
    '- Não faça listas. Não dê exercícios. Não sugira ações.',
  ].join('\n'),
};

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
    CONTEXT_INSTRUCTIONS[context],
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

  const { visible, agreement } = extractAgreement(llmResult.text);

  const asst = await prisma.loveMessage.create({
    data: {
      userId: input.userId,
      context: input.context,
      role: 'assistant',
      content: visible,
      citations: citations.length ? (citations as unknown as object) : undefined,
    },
    select: { id: true },
  });

  return {
    reply: visible,
    safety,
    citations,
    messageId: asst.id,
    ...(agreement ? { proposedAgreement: agreement } : {}),
  };
}

export { formatCitation };
