import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { consentScopes, type ConsentInput, type ConsentScope } from './schema.js';

export const CURRENT_CONSENT_VERSIONS: Record<ConsentScope, string> = {
  terms: '1',
  privacy: '1',
  disclaimer_love_not_therapist: '1',
};

export async function grantConsent(userId: string, input: ConsentInput): Promise<{ consentId: string }> {
  if (input.version !== CURRENT_CONSENT_VERSIONS[input.scope]) {
    throw new AppError('STALE_VERSION', 'Versão do termo desatualizada', 400);
  }
  return prisma.$transaction(async (tx) => {
    const c = await tx.consent.create({
      data: { userId, scope: input.scope, version: input.version },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: { actorId: userId, action: 'consent.grant', target: `${input.scope}:${input.version}` },
    });
    return { consentId: c.id };
  });
}

export async function consentStatus(userId: string): Promise<{ scopes: Record<ConsentScope, boolean> }> {
  const rows = await prisma.consent.findMany({ where: { userId } });
  const scopes = Object.fromEntries(consentScopes.map((s) => [s, false])) as Record<ConsentScope, boolean>;
  for (const r of rows) {
    const scope = r.scope as ConsentScope;
    if (CURRENT_CONSENT_VERSIONS[scope] === r.version) scopes[scope] = true;
  }
  return { scopes };
}
