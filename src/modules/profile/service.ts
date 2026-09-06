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
  await prisma.profile.upsert({
    where: { userId },
    create: { userId, ...input },
    update: input,
  });
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
