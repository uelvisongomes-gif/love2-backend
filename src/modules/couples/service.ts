import crypto from 'node:crypto';
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import type { AcceptInput, InviteInput } from './schema.js';
import { sendWhatsApp } from '../wame/service.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode(): string {
  let out = '';
  const buf = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) out += ALPHABET[buf[i] % ALPHABET.length];
  return out;
}

async function ensureNoCouple(userId: string): Promise<void> {
  const has = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
  });
  if (has) throw new AppError('ALREADY_IN_COUPLE', 'Você já está vinculado(a) a um casal', 409);
}

export async function createInvite(
  inviterId: string,
  input: InviteInput,
): Promise<{ inviteId: string; code: string }> {
  const inviter = await prisma.user.findUnique({ where: { id: inviterId } });
  if (!inviter) throw new AppError('NOT_FOUND', 'Usuário não encontrado', 404);
  if (inviter.email === input.inviteeEmail) {
    throw new AppError('SELF_INVITE', 'Não é possível convidar a si mesma', 400);
  }
  await ensureNoCouple(inviterId);
  const code = newCode();
  const invite = await prisma.coupleInvite.create({
    data: {
      inviterId,
      inviteeEmail: input.inviteeEmail,
      code,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
    select: { id: true, code: true },
  });
  return { inviteId: invite.id, code: invite.code };
}

export async function acceptInvite(
  userId: string,
  input: AcceptInput,
): Promise<{ coupleId: string; myName: string; partnerName: string }> {
  const invite = await prisma.coupleInvite.findUnique({ where: { code: input.code } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    throw new AppError('INVITE_NOT_FOUND', 'Convite não encontrado ou expirado', 404);
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('NOT_FOUND', 'Usuário não encontrado', 404);
  if (user.email !== invite.inviteeEmail) {
    throw new AppError('INVITE_FOR_OTHER', 'Este convite é para outro e-mail', 403);
  }
  if (invite.inviterId === userId) {
    throw new AppError('SELF_INVITE', 'Não é possível aceitar o próprio convite', 400);
  }
  await ensureNoCouple(userId);
  await ensureNoCouple(invite.inviterId);

  const inviter = await prisma.user.findUnique({ where: { id: invite.inviterId } });
  const myName = user.name;
  const partnerName = inviter?.name ?? 'seu parceiro(a)';

  const couple = await prisma.$transaction(async (tx) => {
    const c = await tx.couple.create({
      data: { userAId: invite.inviterId, userBId: userId },
      select: { id: true },
    });
    await tx.coupleInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    return c;
  });

  // Fire-and-forget: notifica ambos pelo WhatsApp se tiverem vínculo
  void notifyCoupleLinked(invite.inviterId, userId, partnerName, myName);

  return { coupleId: couple.id, myName, partnerName };
}

async function notifyCoupleLinked(
  inviterUserId: string,
  accepterUserId: string,
  inviterName: string,
  accepterName: string,
): Promise<void> {
  try {
    const [inviterLink, accepterLink] = await Promise.all([
      prisma.userPhoneLink.findUnique({ where: { userId: inviterUserId } }),
      prisma.userPhoneLink.findUnique({ where: { userId: accepterUserId } }),
    ]);

    if (inviterLink) {
      const msg = `🎉 ${accepterName} aceitou seu convite! Vocês agora estão vinculados como casal no LOVE2. A partir de agora eu cuido de vocês juntos.`;
      await sendWhatsApp(inviterLink.phoneE164, msg);
    }
    if (accepterLink) {
      const msg = `🎉 Prontinho! Você e ${inviterName} agora estão vinculados como casal no LOVE2. Vou cuidar de vocês juntos daqui pra frente.`;
      await sendWhatsApp(accepterLink.phoneE164, msg);
    }
  } catch (err) {
    console.error('[couples] notifyCoupleLinked failed', err);
  }
}

export async function getMyCouple(
  userId: string,
): Promise<{ couple: { id: string; partnerId: string; partnerName: string } | null }> {
  const couple = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    include: { userA: true, userB: true },
  });
  if (!couple) return { couple: null };
  const partner = couple.userAId === userId ? couple.userB : couple.userA;
  return { couple: { id: couple.id, partnerId: partner.id, partnerName: partner.name } };
}
