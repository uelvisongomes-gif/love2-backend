import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';
import { MemoryLlmProvider, setLlmProvider } from '../../ai/llm.js';

const llm = new MemoryLlmProvider();
const app = await buildApp();

async function makeUser(email: string, phone: string) {
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Xx', email, phone, password: 'SenhaForte123' },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: 'SenhaForte123' },
  });
  return login.json().accessToken as string;
}
async function grantDisclaimer(token: string) {
  await app.inject({
    method: 'POST',
    url: '/consent',
    headers: { authorization: `Bearer ${token}` },
    payload: { scope: 'disclaimer_love_not_therapist', version: '1' },
  });
}
async function pairAndOpenWithApprovedBlocks() {
  const aTok = await makeUser('a@x.com', '+5511900000090');
  const bTok = await makeUser('b@x.com', '+5511900000091');
  await grantDisclaimer(aTok);
  await grantDisclaimer(bTok);
  const inv = await app.inject({
    method: 'POST',
    url: '/couples/invite',
    headers: { authorization: `Bearer ${aTok}` },
    payload: { inviteeEmail: 'b@x.com' },
  });
  await app.inject({
    method: 'POST',
    url: '/couples/accept',
    headers: { authorization: `Bearer ${bTok}` },
    payload: { code: inv.json().code },
  });
  llm.enqueue('r1');
  const c = await app.inject({
    method: 'POST',
    url: '/conflicts',
    headers: { authorization: `Bearer ${aTok}` },
    payload: { initialContent: 'briga por dinheiro' },
  });
  const conflictId = c.json().id;
  llm.enqueue(JSON.stringify(['bloco 1', 'bloco 2', 'bloco 3']));
  const gen = await app.inject({
    method: 'POST',
    url: `/conflicts/${conflictId}/blocks/generate`,
    headers: { authorization: `Bearer ${aTok}` },
  });
  for (const b of gen.json().blocks) {
    await app.inject({
      method: 'PATCH',
      url: `/conflicts/${conflictId}/blocks/${b.id}`,
      headers: { authorization: `Bearer ${aTok}` },
      payload: { status: 'approved' },
    });
  }
  return { aTok, bTok, conflictId };
}

beforeEach(async () => {
  setLlmProvider(llm);
  llm.calls.length = 0;
  await prisma.conflictBlock.deleteMany();
  await prisma.conflictMessage.deleteMany();
  await prisma.conflict.deleteMany();
  await prisma.coupleTask.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.event.deleteMany();
  await prisma.checkIn.deleteMany();
  await prisma.safetyScreening.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.loveMessage.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.consent.deleteMany();
  await prisma.couple.deleteMany();
  await prisma.coupleInvite.deleteMany();
  await prisma.twoFactorCode.deleteMany();
  await prisma.user.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

describe('Ponte activation + care-mode gate', () => {
  it('opens ponte, LOVE writes a B-side invitation, status becomes ponte_invited', async () => {
    const { aTok, conflictId } = await pairAndOpenWithApprovedBlocks();
    llm.enqueue('Oi B, sou a LOVE. Seu(sua) parceiro(a) conversou comigo — posso ouvir sua perspectiva?');
    const res = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/ponte/open`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ponte_invited');

    const msgs = await prisma.conflictMessage.findMany({ where: { conflictId, side: 'B' } });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('assistant');
    expect(msgs[0].content).toContain('perspectiva');
  });

  it('B sees authorized summary and accepts, moving to collecting_b', async () => {
    const { aTok, bTok, conflictId } = await pairAndOpenWithApprovedBlocks();
    llm.enqueue('Oi B');
    await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/ponte/open`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    const summary = await app.inject({
      method: 'GET',
      url: `/conflicts/${conflictId}/authorized-summary`,
      headers: { authorization: `Bearer ${bTok}` },
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().blocks).toHaveLength(3);

    const accept = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/ponte/respond`,
      headers: { authorization: `Bearer ${bTok}` },
      payload: { accept: true },
    });
    expect(accept.json().status).toBe('collecting_b');
  });

  it('blocks ponte when A has care-mode active (safety screening positive)', async () => {
    const { aTok, conflictId } = await pairAndOpenWithApprovedBlocks();
    await app.inject({
      method: 'POST',
      url: '/profile/safety-screening',
      headers: { authorization: `Bearer ${aTok}` },
      payload: {
        hasViolenceHistory: true,
        hasSuicidalIdeation: false,
        hasSubstanceAbuse: false,
        hasChildSafetyConcerns: false,
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/ponte/open`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CARE_MODE_ACTIVE');
    expect(res.json().error.message).toContain('188');
  });

  it('rejects opening ponte with no approved blocks', async () => {
    const { aTok } = await pairAndOpenWithApprovedBlocks();
    llm.enqueue('r');
    const c = await app.inject({
      method: 'POST',
      url: '/conflicts',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { initialContent: 'outra briga' },
    });
    const conflictId = c.json().id;
    llm.enqueue(JSON.stringify(['x', 'y', 'z']));
    await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/blocks/generate`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/ponte/open`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('NO_APPROVED_BLOCKS');
  });
});
