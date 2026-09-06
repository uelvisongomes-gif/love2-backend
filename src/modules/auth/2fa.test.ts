import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';
import { MemorySmsSender, setSmsSender } from './sms.js';

const sms = new MemorySmsSender();
setSmsSender(sms);

const app = await buildApp();
const body = { name: 'Maria', email: 'maria@example.com', phone: '+5511999999999', password: 'SenhaForte123' };
let accessToken = '';

beforeEach(async () => {
  sms.sent.length = 0;
  await prisma.twoFactorCode.deleteMany();
  await prisma.user.deleteMany();
  await app.inject({ method: 'POST', url: '/auth/register', payload: body });
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: body.email, password: body.password },
  });
  accessToken = login.json().accessToken;
});
afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

describe('2FA', () => {
  it('sends a 6-digit code by SMS', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/2fa/request',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sent: true });
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0].to).toBe(body.phone);
    expect(sms.sent[0].body).toMatch(/\d{6}/);
  });

  it('verifies the correct code', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/2fa/request',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const code = sms.sent[0].body.match(/\d{6}/)![0];
    const res = await app.inject({
      method: 'POST',
      url: '/auth/2fa/verify',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { code },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ verified: true });
  });

  it('rejects an invalid code with 401 INVALID_2FA', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/2fa/request',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/2fa/verify',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { code: '000000' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_2FA');
  });
});
