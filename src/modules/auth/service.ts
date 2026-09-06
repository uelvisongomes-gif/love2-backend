import crypto from 'node:crypto';
import argon2 from 'argon2';
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { getSmsSender } from './sms.js';
import { signAccessToken, signRefreshToken } from './tokens.js';
import type { LoginInput, RegisterInput, Verify2faInput } from './schema.js';

const TWO_FA_TTL_MS = 5 * 60 * 1000;

export async function registerUser(input: RegisterInput): Promise<{ userId: string }> {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: input.email }, { phone: input.phone }] },
  });
  if (existing) {
    if (existing.email === input.email) throw new AppError('EMAIL_TAKEN', 'E-mail já cadastrado', 409);
    throw new AppError('PHONE_TAKEN', 'Telefone já cadastrado', 409);
  }
  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, phone: input.phone, passwordHash },
    select: { id: true },
  });
  return { userId: user.id };
}

export async function loginUser(input: LoginInput): Promise<{ accessToken: string; refreshToken: string }> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw new AppError('INVALID_CREDENTIALS', 'Credenciais inválidas', 401);
  const ok = await argon2.verify(user.passwordHash, input.password);
  if (!ok) throw new AppError('INVALID_CREDENTIALS', 'Credenciais inválidas', 401);
  return {
    accessToken: signAccessToken(user.id),
    refreshToken: signRefreshToken(user.id),
  };
}

export async function request2fa(userId: string): Promise<{ sent: true }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('NOT_FOUND', 'Usuário não encontrado', 404);
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = await argon2.hash(code, { type: argon2.argon2id });
  await prisma.twoFactorCode.create({
    data: { userId, codeHash, expiresAt: new Date(Date.now() + TWO_FA_TTL_MS) },
  });
  await getSmsSender().send(user.phone, `LOVE Casal: seu código é ${code}. Válido por 5 minutos.`);
  return { sent: true };
}

export async function verify2fa(userId: string, input: Verify2faInput): Promise<{ verified: true }> {
  const candidates = await prisma.twoFactorCode.findMany({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });
  for (const c of candidates) {
    if (await argon2.verify(c.codeHash, input.code)) {
      await prisma.twoFactorCode.update({ where: { id: c.id }, data: { usedAt: new Date() } });
      return { verified: true };
    }
  }
  throw new AppError('INVALID_2FA', 'Código inválido ou expirado', 401);
}
