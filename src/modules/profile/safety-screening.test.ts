import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';
import { careModeActive } from './safety-screening.js';

const app = await buildApp();

async function makeAuthedUser() {
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Xx', email: 's@x.com', phone: '+5511900000031', password: 'SenhaForte123' },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 's@x.com', password: 'SenhaForte123' },
  });
  return login.json().accessToken as string;
}

beforeEach(async () => {
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

describe('Safety screening', () => {
  it('stores screening and returns careModeActive=false for all-negative', async () => {
    const token = await makeAuthedUser();
    const res = await app.inject({
      method: 'POST',
      url: '/profile/safety-screening',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        hasViolenceHistory: false,
        hasSuicidalIdeation: false,
        hasSubstanceAbuse: false,
        hasChildSafetyConcerns: false,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ careModeActive: false });
  });

  it('flags careModeActive=true when any concern is true', async () => {
    const token = await makeAuthedUser();
    const res = await app.inject({
      method: 'POST',
      url: '/profile/safety-screening',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        hasViolenceHistory: true,
        hasSuicidalIdeation: false,
        hasSubstanceAbuse: false,
        hasChildSafetyConcerns: false,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ careModeActive: true });

    const user = await prisma.user.findFirst();
    expect(await careModeActive(user!.id)).toBe(true);
  });

  it('GET returns 404 before submission', async () => {
    const token = await makeAuthedUser();
    const res = await app.inject({
      method: 'GET',
      url: '/profile/safety-screening',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
