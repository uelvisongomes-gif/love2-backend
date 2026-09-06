import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';

const app = await buildApp();

async function makeUser(email: string, phone: string): Promise<string> {
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

beforeEach(async () => {
  await prisma.couple.deleteMany();
  await prisma.coupleInvite.deleteMany();
  await prisma.twoFactorCode.deleteMany();
  await prisma.user.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

describe('Couples flow', () => {
  it('invite + accept creates a couple', async () => {
    const aTok = await makeUser('a@x.com', '+5511900000001');
    const bTok = await makeUser('b@x.com', '+5511900000002');

    const inv = await app.inject({
      method: 'POST',
      url: '/couples/invite',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { inviteeEmail: 'b@x.com' },
    });
    expect(inv.statusCode).toBe(201);
    const code = inv.json().code as string;
    expect(code).toMatch(/^[A-Z0-9]{8}$/);

    const acc = await app.inject({
      method: 'POST',
      url: '/couples/accept',
      headers: { authorization: `Bearer ${bTok}` },
      payload: { code },
    });
    expect(acc.statusCode).toBe(200);
    expect(typeof acc.json().coupleId).toBe('string');

    const me = await app.inject({
      method: 'GET',
      url: '/couples/me',
      headers: { authorization: `Bearer ${bTok}` },
    });
    expect(me.json().couple).not.toBeNull();
  });

  it('rejects self-invite with 400 SELF_INVITE', async () => {
    const aTok = await makeUser('a@x.com', '+5511900000001');
    const res = await app.inject({
      method: 'POST',
      url: '/couples/invite',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { inviteeEmail: 'a@x.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('SELF_INVITE');
  });

  it('rejects accepting an unknown code with 404 INVITE_NOT_FOUND', async () => {
    const bTok = await makeUser('b@x.com', '+5511900000002');
    const res = await app.inject({
      method: 'POST',
      url: '/couples/accept',
      headers: { authorization: `Bearer ${bTok}` },
      payload: { code: 'ZZZZZZZZ' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('INVITE_NOT_FOUND');
  });
});
