import argon2 from 'argon2';
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import type { RegisterInput } from './schema.js';

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
