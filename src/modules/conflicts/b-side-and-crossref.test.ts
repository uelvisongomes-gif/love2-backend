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
async function fullFlowUpToBCollecting(): Promise<{ aTok: string; bTok: string; conflictId: string }> {
  const aTok = await makeUser('a@x.com', '+5511900000100');
  const bTok = await makeUser('b@x.com', '+5511900000101');
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
  llm.enqueue('r');
  const c = await app.inject({
    method: 'POST',
    url: '/conflicts',
    headers: { authorization: `Bearer ${aTok}` },
    payload: { initialContent: 'briga por dinheiro' },
  });
  const conflictId = c.json().id;
  llm.enqueue(JSON.stringify(['b1', 'b2', 'b3']));
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
  llm.enqueue('convite pra B');
  await app.inject({
    method: 'POST',
    url: `/conflicts/${conflictId}/ponte/open`,
    headers: { authorization: `Bearer ${aTok}` },
  });
  await app.inject({
    method: 'POST',
    url: `/conflicts/${conflictId}/ponte/respond`,
    headers: { authorization: `Bearer ${bTok}` },
    payload: { accept: true },
  });
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

describe('B-side conversation + cross-reference', () => {
  it('B can post messages once status=collecting_b; A cannot see B messages', async () => {
    const { aTok, bTok, conflictId } = await fullFlowUpToBCollecting();
    llm.enqueue('resposta pra B');
    const res = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/messages`,
      headers: { authorization: `Bearer ${bTok}` },
      payload: { content: 'aqui é a minha versão' },
    });
    expect(res.statusCode).toBe(201);

    const aView = await app.inject({
      method: 'GET',
      url: `/conflicts/${conflictId}`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    for (const m of aView.json().messages) expect(m.side).toBe('A');
  });

  it('cross-reference stores per-side insights and returns commonGround+patterns', async () => {
    const { aTok, bTok, conflictId } = await fullFlowUpToBCollecting();
    llm.enqueue('resposta pra B');
    await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/messages`,
      headers: { authorization: `Bearer ${bTok}` },
      payload: { content: 'aqui é a minha versão' },
    });

    const crossOut = JSON.stringify({
      commonGround: 'Ambos se importam com estabilidade financeira.',
      patterns: ['os dois falam sobre segurança, sob rótulos diferentes'],
      aInsight: 'insight privado pra A',
      bInsight: 'insight privado pra B',
    });
    llm.enqueue(crossOut);
    const res = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/cross-reference`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().commonGround).toContain('estabilidade');
    expect(res.json().mySideInsight).toBe('insight privado pra A');

    const bInsight = await app.inject({
      method: 'GET',
      url: `/conflicts/${conflictId}/insight`,
      headers: { authorization: `Bearer ${bTok}` },
    });
    expect(bInsight.json().insight).toBe('insight privado pra B');

    const aInsight = await app.inject({
      method: 'GET',
      url: `/conflicts/${conflictId}/insight`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(aInsight.json().insight).toBe('insight privado pra A');
  });

  it('cross-reference rejects if B has not spoken', async () => {
    const { aTok, conflictId } = await fullFlowUpToBCollecting();
    const res = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/cross-reference`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('B_HAS_NOT_SPOKEN');
  });
});
