import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';

export const safetyScreeningInput = z
  .object({
    hasViolenceHistory: z.boolean(),
    hasSuicidalIdeation: z.boolean(),
    hasSubstanceAbuse: z.boolean(),
    hasChildSafetyConcerns: z.boolean(),
  })
  .strict();
export type SafetyScreeningInput = z.infer<typeof safetyScreeningInput>;

export async function submitSafetyScreening(
  userId: string,
  input: SafetyScreeningInput,
): Promise<{ careModeActive: boolean }> {
  await prisma.safetyScreening.upsert({
    where: { userId },
    create: { userId, ...input },
    update: input,
  });
  return { careModeActive: careModeFromInput(input) };
}

export async function getSafetyScreening(userId: string) {
  const s = await prisma.safetyScreening.findUnique({ where: { userId } });
  if (!s) throw new AppError('SCREENING_NOT_FOUND', 'Triagem não realizada', 404);
  return s;
}

export async function careModeActive(userId: string): Promise<boolean> {
  const s = await prisma.safetyScreening.findUnique({ where: { userId } });
  if (!s) return false;
  return careModeFromInput(s);
}

function careModeFromInput(
  s: Pick<
    SafetyScreeningInput,
    'hasViolenceHistory' | 'hasSuicidalIdeation' | 'hasSubstanceAbuse' | 'hasChildSafetyConcerns'
  >,
): boolean {
  return (
    s.hasViolenceHistory ||
    s.hasSuicidalIdeation ||
    s.hasSubstanceAbuse ||
    s.hasChildSafetyConcerns
  );
}
