import { prisma } from '../../db/client.js';
import { loadConfig } from '../../config.js';
import { getWame } from './client.js';
import { chatWithLove } from '../../ai/orchestrator.js';
import { TypeMessage } from '@raphaelvserafim/client-api-whatsapp';

/**
 * Normaliza um número pra E.164 sem "+". Ex: "+55 (11) 99999-8888" → "5511999998888".
 * Aceita input já limpo. Retorna null se for muito curto.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D+/g, '');
  if (digits.length < 10) return null;
  return digits;
}

/**
 * Gera código único de 6 dígitos que expira em 10min. Se o user já tem
 * um vínculo ativo, retorna null (sinaliza que já está vinculado).
 */
export async function generateLinkCode(userId: string): Promise<
  { code: string; expiresAt: Date } | { alreadyLinked: true; phoneE164: string }
> {
  const existing = await prisma.userPhoneLink.findUnique({ where: { userId } });
  if (existing) return { alreadyLinked: true, phoneE164: existing.phoneE164 };

  // invalida códigos antigos
  await prisma.phoneLinkCode.deleteMany({
    where: { userId, OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }] },
  });

  // Tenta até 5x um código de 6 dígitos único
  for (let i = 0; i < 5; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    try {
      await prisma.phoneLinkCode.create({ data: { userId, code, expiresAt } });
      return { code, expiresAt };
    } catch {
      // colisão de code — tenta de novo
    }
  }
  throw new Error('Não foi possível gerar código único');
}

export async function unlinkPhone(userId: string): Promise<void> {
  await prisma.userPhoneLink.deleteMany({ where: { userId } });
}

export async function getLinkStatus(userId: string): Promise<{
  linked: boolean;
  phoneE164?: string;
  loveNumber: string | null;
}> {
  const cfg = loadConfig();
  const link = await prisma.userPhoneLink.findUnique({ where: { userId } });
  return {
    linked: Boolean(link),
    phoneE164: link?.phoneE164,
    loveNumber: cfg.WAME_LOVE_NUMBER ?? null,
  };
}

/**
 * Consome um código de 6 dígitos e cria o vínculo. Chamado do fluxo de webhook.
 */
async function consumeLinkCode(code: string, phoneE164: string): Promise<string | null> {
  const now = new Date();
  const record = await prisma.phoneLinkCode.findFirst({
    where: { code, expiresAt: { gt: now }, usedAt: null },
  });
  if (!record) return null;
  // Já tem vínculo pra esse user?
  const existing = await prisma.userPhoneLink.findUnique({ where: { userId: record.userId } });
  if (existing) return null;
  await prisma.$transaction([
    prisma.phoneLinkCode.update({ where: { id: record.id }, data: { usedAt: now } }),
    prisma.userPhoneLink.create({ data: { userId: record.userId, phoneE164 } }),
  ]);
  return record.userId;
}

/**
 * Envia texto pelo WA. Fire-and-forget do lado do backend — logs em caso de falha.
 */
export async function sendWhatsApp(phoneE164: string, text: string): Promise<void> {
  const wame = getWame();
  if (!wame) {
    console.warn('[wame] getWame() null — mensagem não enviada:', { phoneE164, text: text.slice(0, 60) });
    return;
  }
  try {
    await wame.message.send({
      type: TypeMessage.TEXT,
      body: { to: phoneE164, text },
    });
    await prisma.whatsAppMessage.create({
      data: {
        phoneE164,
        direction: 'out',
        provider: 'wame',
        kind: 'text',
        content: text,
      },
    });
  } catch (err) {
    console.error('[wame] send failed', err);
  }
}

/**
 * Baixa áudio direto da WAME (rota `/message/{id}/media`) e transcreve com Whisper.
 * Retorna null se falhar.
 */
async function transcribeWhatsAppAudio(audioId: string): Promise<string | null> {
  const cfg = loadConfig();
  if (!cfg.WAME_API_KEY || !cfg.OPENAI_API_KEY) return null;
  try {
    const mediaUrl = `${cfg.WAME_SERVER}/${cfg.WAME_API_KEY}/message/${audioId}/media`;
    const mediaRes = await fetch(mediaUrl);
    if (!mediaRes.ok) {
      console.error('[wame] media fetch failed', mediaRes.status);
      return null;
    }
    const buffer = Buffer.from(await mediaRes.arrayBuffer());
    const contentType = mediaRes.headers.get('content-type') ?? 'audio/ogg';
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), 'audio.ogg');
    form.append('model', 'whisper-1');
    form.append('language', 'pt');
    const transcRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.OPENAI_API_KEY}` },
      body: form,
    });
    if (!transcRes.ok) {
      console.error('[wame] whisper failed', await transcRes.text());
      return null;
    }
    const json = (await transcRes.json()) as { text?: string };
    return json.text?.trim() ?? null;
  } catch (err) {
    console.error('[wame] transcribe failed', err);
    return null;
  }
}

interface IncomingText {
  wamId: string;
  from: string; // phoneE164
  text: string;
  raw: unknown;
}

interface IncomingAudio {
  wamId: string;
  from: string;
  audioId: string; // WAME media id, downloaded via /message/{id}/media
  raw: unknown;
}

type Incoming = IncomingText | IncomingAudio;

const HELP_UNLINKED = [
  'Oi! Sou a LOVE 💛',
  '',
  'Pra começar, cole aqui o *código de 6 dígitos* que aparece em love2.com.br/whatsapp (você precisa estar logado).',
  '',
  'Se ainda não tem conta, crie em love2.com.br primeiro.',
].join('\n');

const HELP_LINKED_GREETING = [
  'Prontinho — sua conta tá vinculada. 🌸',
  '',
  'Agora é só me contar o que rolar no dia. Posso te ajudar a pensar, desabafar ou resolver algo com seu parceiro.',
].join('\n');

/**
 * Processa uma mensagem que chegou. Já retorna null se for duplicada (idempotência).
 */
export async function handleIncoming(input: Incoming): Promise<void> {
  const phoneE164 = normalizePhone(input.from);
  if (!phoneE164) return;

  // Idempotência via wamId
  const already = await prisma.whatsAppMessage.findUnique({ where: { wamId: input.wamId } });
  if (already) return;

  // Extrai texto
  let text: string | null = null;
  let kind: 'text' | 'audio' = 'text';
  if ('text' in input) {
    text = input.text.trim();
  } else {
    kind = 'audio';
    text = await transcribeWhatsAppAudio(input.audioId);
  }

  // Grava a mensagem in
  const link = await prisma.userPhoneLink.findUnique({ where: { phoneE164 } });
  const userIdOfSender = link?.userId ?? null;

  await prisma.whatsAppMessage.create({
    data: {
      userId: userIdOfSender,
      phoneE164,
      direction: 'in',
      provider: 'wame',
      wamId: input.wamId,
      kind,
      content: text,
      raw: input.raw as never,
    },
  });

  if (link) {
    await prisma.userPhoneLink.update({
      where: { userId: link.userId },
      data: { lastSeenAt: new Date() },
    });
  }

  // Sem texto (áudio que não transcreveu ou vazio)
  if (!text || text.length === 0) {
    await sendWhatsApp(
      phoneE164,
      link
        ? 'Não consegui entender o áudio, tenta digitar ou mandar de novo mais alto?'
        : HELP_UNLINKED,
    );
    return;
  }

  // Não vinculado — tenta código
  if (!link) {
    const codeMatch = text.match(/\b(\d{6})\b/);
    if (codeMatch) {
      const consumedUserId = await consumeLinkCode(codeMatch[1]!, phoneE164);
      if (consumedUserId) {
        await sendWhatsApp(phoneE164, HELP_LINKED_GREETING);
        return;
      }
    }
    await sendWhatsApp(phoneE164, HELP_UNLINKED);
    return;
  }

  // Vinculado — passa pra LOVE
  try {
    const result = await chatWithLove({
      userId: link.userId,
      content: text,
      context: 'general',
    });
    await sendWhatsApp(phoneE164, result.reply);
  } catch (err) {
    console.error('[wame] chatWithLove failed', err);
    await sendWhatsApp(
      phoneE164,
      'Deu um probleminha aqui do meu lado. Tenta de novo em um minutinho?',
    );
  }
}
