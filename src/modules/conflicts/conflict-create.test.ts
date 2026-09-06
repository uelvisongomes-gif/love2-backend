import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';
import { MemoryLlmProvider, setLlmProvider } from '../../ai/llm.js';

const llm = new MemoryLlmProvider();
const app = await buildApp();

async function makeAuthedUser(email: string, phone: string) {
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
async function pairCouple() {
  const aTok = await makeAuthedUser('a@x.com', '+5511900000070');
  const bTok = await makeAuthedUser('b@x.com', '+5511900000071');
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
  return { aTok, bTok };
}

beforeEach(async () => {
  setLlmProvider(llm);
  llm.calls.length = 0;
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

describe('Conflict — create + A talks', () => {
  it('A creates a conflict and LOVE responds; both messages persisted on A side', async () => {
    const { aTok } = await pairCouple();
    llm.enqueue('Entendo, vamos por partes.');
    const res = await app.inject({
      method: 'POST',
      url: '/conflicts',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { initialContent: 'Brigamos por dinheiro de novo.', pillar: 'financeiro' },
    });
    expect(res.statusCode).toBe(201);
    const conflictId = res.json().id;

    const msgs = await prisma.conflictMessage.findMany({
      where: { conflictId },
      orderBy: { createdAt: 'asc' },
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ side: 'A', role: 'user' });
    expect(msgs[1]).toMatchObject({ side: 'A', role: 'assistant', content: 'Entendo, vamos por partes.' });
  });

  it('creating a conflict without a couple returns 403 NO_COUPLE', async () => {
    const tok = await makeAuthedUser('solo@x.com', '+5511900000072');
    await grantDisclaimer(tok);
    const res = await app.inject({
      method: 'POST',
      url: '/conflicts',
      headers: { authorization: `Bearer ${tok}` },
      payload: { initialContent: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NO_COUPLE');
  });

  it('B cannot post messages while status is collecting_a (WRONG_SIDE)', async () => {
    const { aTok, bTok } = await pairCouple();
    llm.enqueue('resposta 1');
    const create = await app.inject({
      method: 'POST',
      url: '/conflicts',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { initialContent: 'x' },
    });
    const id = create.json().id;

    const res = await app.inject({
      method: 'POST',
      url: `/conflicts/${id}/messages`,
      headers: { authorization: `Bearer ${bTok}` },
      payload: { content: 'quero falar' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('WRONG_SIDE');
  });

  it('A gets only A-side messages via GET /conflicts/:id', async () => {
    const { aTok } = await pairCouple();
    llm.enqueue('r1');
    llm.enqueue('r2');
    const create = await app.inject({
      method: 'POST',
      url: '/conflicts',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { initialContent: 'primeira' },
    });
    const id = create.json().id;
    await app.inject({
      method: 'POST',
      url: `/conflicts/${id}/messages`,
      headers: { authorization: `Bearer ${aTok}` },
      payload: { content: 'segunda' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/conflicts/${id}`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().messages).toHaveLength(4);
    for (const m of res.json().messages) expect(m.side).toBe('A');
  });
});
