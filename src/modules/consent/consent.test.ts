import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';

const app = await buildApp();

async function makeUser(): Promise<string> {
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Xx', email: 'x@x.com', phone: '+5511900000010', password: 'SenhaForte123' },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'x@x.com', password: 'SenhaForte123' },
  });
  return login.json().accessToken as string;
}

beforeEach(async () => {
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

describe('Consent', () => {
  it('records a consent and writes an audit log', async () => {
    const tok = await makeUser();
    const res = await app.inject({
      method: 'POST',
      url: '/consent',
      headers: { authorization: `Bearer ${tok}` },
      payload: { scope: 'terms', version: '1' },
    });
    expect(res.statusCode).toBe(201);
    expect(typeof res.json().consentId).toBe('string');
    const audits = await prisma.auditLog.findMany();
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('consent.grant');
  });

  it('returns status false for missing scope, true when granted at current version', async () => {
    const tok = await makeUser();
    const before = await app.inject({
      method: 'GET',
      url: '/consent/status',
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(before.json().scopes.terms).toBe(false);

    await app.inject({
      method: 'POST',
      url: '/consent',
      headers: { authorization: `Bearer ${tok}` },
      payload: { scope: 'terms', version: '1' },
    });
    const after = await app.inject({
      method: 'GET',
      url: '/consent/status',
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(after.json().scopes.terms).toBe(true);
  });

  it('rejects a version that does not match the current constant with 400 STALE_VERSION', async () => {
    const tok = await makeUser();
    const res = await app.inject({
      method: 'POST',
      url: '/consent',
      headers: { authorization: `Bearer ${tok}` },
      payload: { scope: 'terms', version: '0' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('STALE_VERSION');
  });
});
