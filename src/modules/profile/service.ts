import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { PILLARS, type UpsertProfileInput } from './schema.js';

interface Preferences {
  religion: string | null;
  religionOptIn: boolean;
  politicsOptIn: boolean;
  avoidedTopics: string[];
}

export async function upsertProfile(userId: string, input: UpsertProfileInput): Promise<void> {
  // Datas vêm como ISO string do JSON — Prisma aceita Date; convertemos aqui
  const data: Record<string, unknown> = { ...input };
  if (input.birthDate !== undefined) {
    data.birthDate = input.birthDate ? new Date(input.birthDate) : null;
  }
  if (input.relationshipStart !== undefined) {
    data.relationshipStart = input.relationshipStart ? new Date(input.relationshipStart) : null;
  }
  await prisma.profile.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}

export async function updateUserPhoto(userId: string, photoUrl: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { photoUrl } });
}

export async function removeUserPhoto(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { photoUrl: null } });
}

export async function getUserBasic(userId: string): Promise<{
  id: string;
  name: string;
  email: string;
  phone: string;
  photoUrl: string | null;
}> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, phone: true, photoUrl: true },
  });
  if (!u) throw new AppError('USER_NOT_FOUND', 'Usuário não encontrado', 404);
  return u;
}

export async function getProfile(userId: string) {
  const p = await prisma.profile.findUnique({ where: { userId } });
  if (!p) throw new AppError('PROFILE_NOT_FOUND', 'Perfil ainda não preenchido', 404);
  return p;
}

export async function getAllowedTopics(userId: string): Promise<{ allowedTopics: string[] }> {
  const p = await prisma.profile.findUnique({ where: { userId } });
  const avoided = new Set<string>();
  if (p?.preferences) {
    const prefs = p.preferences as unknown as Preferences;
    for (const t of prefs.avoidedTopics ?? []) avoided.add(t);
    if (!prefs.religionOptIn) avoided.add('espiritualidade');
  }
  return { allowedTopics: PILLARS.filter((t) => !avoided.has(t)) };
}
