import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';

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

async function pairCouple() {
  const aTok = await makeAuthedUser('a@x.com', '+5511900000060');
  const bTok = await makeAuthedUser('b@x.com', '+5511900000061');
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

describe('Health index', () => {
  it('returns 60 baseline with no signal', async () => {
    const { aTok } = await pairCouple();
    const res = await app.inject({
      method: 'GET',
      url: '/couples/me/health',
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.overall).toBe(60);
    expect(body.byPillar.comunicacao).toBe(60);
    expect(body.weekly.badEventsCount).toBe(0);
  });

  it('drops on bad events, rises on good + intimacy + tasks completed', async () => {
    const { aTok, bTok } = await pairCouple();
    await app.inject({
      method: 'POST',
      url: '/checkins/today',
      headers: { authorization: `Bearer ${aTok}` },
      payload: {
        moodOverall: 6,
        intimacyToday: true,
        events: [
          { kind: 'bad', pillar: 'comunicacao', intensity: 5, description: 'x' },
          { kind: 'bad', pillar: 'financeiro', intensity: 4, description: 'y' },
          { kind: 'good', pillar: 'intimidade', intensity: 8, description: 'z' },
        ],
      },
    });
    const t = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { pillar: 'comunicacao', title: 'conversar' },
    });
    const id = t.json().id;
    await app.inject({ method: 'POST', url: `/tasks/${id}/complete`, headers: { authorization: `Bearer ${aTok}` } });
    await app.inject({ method: 'POST', url: `/tasks/${id}/complete`, headers: { authorization: `Bearer ${bTok}` } });

    const res = await app.inject({
      method: 'GET',
      url: '/couples/me/health',
      headers: { authorization: `Bearer ${aTok}` },
    });
    // baseline 60 -6 +3 +2 +3 = 62
    expect(res.json().overall).toBe(62);
    expect(res.json().weekly.badEventsCount).toBe(2);
    expect(res.json().weekly.tasksCompleted).toBe(1);
  });

  it('rejects without a couple (403)', async () => {
    const tok = await makeAuthedUser('solo@x.com', '+5511900000062');
    const res = await app.inject({
      method: 'GET',
      url: '/couples/me/health',
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NO_COUPLE');
  });
});
