import { prisma } from '../db/client.js';
import { loadConfig } from '../config.js';
import { getLlmProvider, type LlmMessage } from './llm.js';
import { formatCitation, searchRag } from './rag.js';
import { assessMessage, SAFETY_EMERGENCY_MESSAGE, type SafetyFinding } from './safety.js';
import { buildUserContextBlock } from './user-context.js';

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
  callPartner?: CallPartnerRequest;
}

/** Extract the text inside <acordo>...</acordo> if present, and strip the tag from the visible reply. */
function extractAgreement(text: string): { visible: string; agreement: string | null } {
  const match = text.match(/<acordo>([\s\S]*?)<\/acordo>/i);
  if (!match) return { visible: text, agreement: null };
  const agreement = match[1]?.trim() ?? null;
  const visible = text.replace(/<acordo>[\s\S]*?<\/acordo>/gi, '').trim();
  return { visible, agreement: agreement && agreement.length > 0 ? agreement : null };
}

export interface CallPartnerRequest {
  topicos: string[];
  mensagemParaParceiro: string;
}

/**
 * Extract <chamar_parceiro>JSON</chamar_parceiro> tag if present and strip from visible.
 * JSON schema: { "topicos": string[], "mensagem_para_parceiro": string }
 */
function extractCallPartner(text: string): {
  visible: string;
  callPartner: CallPartnerRequest | null;
} {
  const match = text.match(/<chamar_parceiro>([\s\S]*?)<\/chamar_parceiro>/i);
  if (!match) return { visible: text, callPartner: null };
  const raw = match[1]?.trim() ?? '';
  const visible = text.replace(/<chamar_parceiro>[\s\S]*?<\/chamar_parceiro>/gi, '').trim();
  try {
    const parsed = JSON.parse(raw) as { topicos?: unknown; mensagem_para_parceiro?: unknown };
    const topicos = Array.isArray(parsed.topicos)
      ? parsed.topicos.filter((t): t is string => typeof t === 'string' && t.length > 0)
      : [];
    const mensagemParaParceiro =
      typeof parsed.mensagem_para_parceiro === 'string' ? parsed.mensagem_para_parceiro : '';
    if (topicos.length === 0 || !mensagemParaParceiro) {
      return { visible, callPartner: null };
    }
    return { visible, callPartner: { topicos, mensagemParaParceiro } };
  } catch {
    return { visible, callPartner: null };
  }
}

const STYLE_RULES = [
  'ESTILO — MUITO IMPORTANTE:',
  '- Respostas de 2 a 10 frases — nunca mais que isso. Prefira menos quando conseguir.',
  '- Fale como amiga conversando, não como texto formal. Sem introdução vazia, sem retórica.',
  '- Nada de "que interessante", "entendo você", "isso faz sentido" — vai direto no ponto.',
  '- Faça 1 pergunta por vez (ou 1 sugestão). Nada de listas longas ou parágrafos.',
  '- USE O NOME DA PESSOA quando fizer sentido — cria intimidade. O nome está no contexto.',
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
    '- USE O NOME da pessoa nas respostas — cria proximidade.',
    '',
    'FLUXO DE ACIONAR PARCEIRO (MUITO IMPORTANTE):',
    'Quando o problema envolve o parceiro E o casal está vinculado (veja no CONTEXTO), você tem um objetivo claro: entender o problema em profundidade e, no momento certo, propor chamar o parceiro pra mediação.',
    '',
    'ETAPA 1 — ENTENDER (2 a 5 turnos):',
    '- Deixe a pessoa contar o que aconteceu. Faça perguntas abertas pra entender fatos, o que sentiu, o que precisava, o que imagina que o outro sentiu.',
    '- Não tenta resolver ainda. Só escuta e devolve espelhos ("então o que mais te incomodou foi X, é isso?").',
    '',
    'ETAPA 2 — DIAGNOSTICAR (1 turno):',
    '- Quando sentir que ouviu o essencial, entrega um diagnóstico curto e claro. Ex: "Uelvison, percebo que vocês estão passando por um atrito envolvendo A e B, e que isso te deixou triste porque você sentiu que não foi ouvido. Faz sentido?"',
    '- Espera a pessoa confirmar ou corrigir.',
    '',
    'ETAPA 3 — PROPOR MEDIAÇÃO A 3 (1 turno):',
    '- Depois do diagnóstico confirmado, proponha assim (adapte com naturalidade, mas mantenha o tom): "Pra a gente resolver isso de verdade, sugiro trocarmos uma ideia juntos os 3 — eu mediando pra tentar ajudar vocês. Posso chamar [nome do parceiro]?"',
    '- Se a pessoa disser sim, vá pra ETAPA 4.',
    '- Se disser não, respeite. Pergunta se quer só continuar conversando com você.',
    '',
    'ETAPA 4 — LISTAR TÓPICOS + CONFIRMAR (1 turno):',
    '- Lista em tópicos numerados o que vai levar pra conversa com o parceiro. Máximo 5 tópicos, cada um em UMA frase curta. Exemplo:',
    '   "Antes de chamar Ludymilla, vou levar esses pontos pra ela — você me diz se posso ou quer tirar algum:',
    '    1. [tópico 1]',
    '    2. [tópico 2]',
    '    3. [tópico 3]',
    '    Pode todos? Ou quer tirar algum?"',
    '- Espera a pessoa confirmar. Se pedir pra tirar/ajustar, repete a lista revisada.',
    '',
    'ETAPA 5 — DISPARAR (1 turno, DEPOIS de confirmação):',
    '- Emite a tag no final da resposta. O texto visível é curto: "Vou falar com [nome do parceiro] agora. Assim que ela/ele responder eu volto pra você." (adapte, mas seja curta)',
    '- Tag no formato JSON válido:',
    '   <chamar_parceiro>{"topicos": ["...", "..."], "mensagem_para_parceiro": "Olá [nome do parceiro], sou a LOVE. [nome do usuário] me disse que teve um atrito com você e está chateado(a). Antes de qualquer coisa, gostaria de entender de você o que aconteceu. Podemos conversar sobre isso?"}</chamar_parceiro>',
    '- A mensagem_para_parceiro NÃO revela os tópicos ainda — só convida pra conversar. LOVE vai construir o entendimento com o parceiro do zero, como fez com a pessoa A.',
    '- IMPORTANTE: o JSON dentro da tag DEVE ser válido — aspas duplas, escape \\n corretamente. NUNCA use crases nem markdown dentro do JSON.',
    '',
    'REGRA CRÍTICA da tag <chamar_parceiro>: só emita ela DEPOIS que a pessoa explicitamente confirmou a lista de tópicos (ETAPA 4). Nunca antes.',
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
    '5) ACORDO — proponha UM acordo curto e prático (uma frase só). Comece com "Que tal se..." Pergunte se topa ou quer ajustar.',
    'MARCAÇÃO ESPECIAL (CRÍTICO):',
    '- SEMPRE que estiver propondo o acordo da etapa 5, termine a resposta com uma tag XML na última linha:',
    '  <acordo>frase única, imperativa, direta ao ponto — no MÁXIMO 15 palavras</acordo>',
    '- FORMATO OBRIGATÓRIO do texto dentro da tag: começa com verbo no infinitivo ("Avisar", "Pausar", "Combinar", etc), sem "vou", "vamos", sem "que tal", sem pergunta, sem contexto emocional. É um lembrete curto — não é uma frase completa.',
    '- Exemplos BONS: <acordo>Avisar com 24h de antecedência quando tiver compromisso urgente no trabalho.</acordo> | <acordo>Pausar por 30 min quando a conversa esquentar sobre dinheiro.</acordo>',
    '- Exemplo RUIM (não faça): <acordo>Que tal se vocês combinassem que quando um tiver um compromisso, avisa antes e depois conversam sobre como dividir</acordo>',
    '- NUNCA use essa tag nas etapas 1-4.',
    '- Se a pessoa pedir pra ajustar, envie versão nova também com tag <acordo>...</acordo> obedecendo o mesmo formato curto.',
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
  userContextBlock: string,
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
    userContextBlock,
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

  const userContextBlock = await buildUserContextBlock(input.userId);
  const system = buildSystemPrompt(
    input.context,
    input.allowedTopics,
    ragBlock,
    isFirstMessage,
    userContextBlock,
  );
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

  const { visible: afterAgreement, agreement } = extractAgreement(llmResult.text);
  const { visible, callPartner } = extractCallPartner(afterAgreement);

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
    ...(callPartner && { callPartner }),
    ...(agreement ? { proposedAgreement: agreement } : {}),
  };
}

export { formatCitation };
