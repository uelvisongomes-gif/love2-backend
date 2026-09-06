import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';
import { MemoryLlmProvider, setLlmProvider } from '../../ai/llm.js';

const llm = new MemoryLlmProvider();
setLlmProvider(llm);

const app = await buildApp();

async function makeAuthedUser(email = 'love@x.com', phone = '+5511900000021') {
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

beforeEach(async () => {
  await prisma.loveMessage.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.consent.deleteMany();
  await prisma.couple.deleteMany();
  await prisma.coupleInvite.deleteMany();
  await prisma.twoFactorCode.deleteMany();
  await prisma.user.deleteMany();
  llm.calls.length = 0;
});
afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

describe('POST /love/chat', () => {
  it('rejects without disclaimer consent (403 CONSENT_REQUIRED)', async () => {
    const tok = await makeAuthedUser();
    const res = await app.inject({
      method: 'POST',
      url: '/love/chat',
      headers: { authorization: `Bearer ${tok}` },
      payload: { content: 'oi', context: 'general' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CONSENT_REQUIRED');
  });

  it('returns LOVE reply after consent is granted', async () => {
    const tok = await makeAuthedUser();
    await grantDisclaimer(tok);
    llm.enqueue('Sou a LOVE. Como posso ajudar?');
    const res = await app.inject({
      method: 'POST',
      url: '/love/chat',
      headers: { authorization: `Bearer ${tok}` },
      payload: { content: 'oi', context: 'general' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reply).toContain('LOVE');
    expect(body.safety.category).toBe('safe');
    expect(typeof body.messageId).toBe('string');
  });

  it('returns emergency response on unsafe input (200, safety category set, LLM not called)', async () => {
    const tok = await makeAuthedUser();
    await grantDisclaimer(tok);
    const res = await app.inject({
      method: 'POST',
      url: '/love/chat',
      headers: { authorization: `Bearer ${tok}` },
      payload: { content: 'ele me bateu ontem', context: 'conflict' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.safety.category).toBe('violence');
    expect(body.reply).toContain('188');
    expect(llm.calls).toHaveLength(0);
  });
});
