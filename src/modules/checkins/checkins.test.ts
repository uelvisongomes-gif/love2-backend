import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';

const app = await buildApp();

async function makeAuthedUser() {
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Xx', email: 'c@x.com', phone: '+5511900000032', password: 'SenhaForte123' },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'c@x.com', password: 'SenhaForte123' },
  });
  return login.json().accessToken as string;
}

beforeEach(async () => {
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

const validBody = {
  moodOverall: 7,
  events: [
    { kind: 'bad' as const, pillar: 'comunicacao', intensity: 6, description: 'Bati boca por causa do jantar' },
    { kind: 'good' as const, pillar: 'intimidade', intensity: 8, description: 'Assistimos filme juntos' },
  ],
  intimacyToday: true,
  dateNightToday: false,
};

describe('Check-in', () => {
  it('creates today and returns the check-in with events', async () => {
    const tok = await makeAuthedUser();
    const res = await app.inject({
      method: 'POST',
      url: '/checkins/today',
      headers: { authorization: `Bearer ${tok}` },
      payload: validBody,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.moodOverall).toBe(7);
    expect(body.events).toHaveLength(2);
  });

  it('re-posting today replaces the check-in (upsert semantics)', async () => {
    const tok = await makeAuthedUser();
    await app.inject({
      method: 'POST',
      url: '/checkins/today',
      headers: { authorization: `Bearer ${tok}` },
      payload: validBody,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/checkins/today',
      headers: { authorization: `Bearer ${tok}` },
      payload: { ...validBody, moodOverall: 4, events: [] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().moodOverall).toBe(4);
    expect(res.json().events).toHaveLength(0);

    const dbCount = await prisma.checkIn.count();
    expect(dbCount).toBe(1);
  });

  it('rejects invalid pillar (400)', async () => {
    const tok = await makeAuthedUser();
    const res = await app.inject({
      method: 'POST',
      url: '/checkins/today',
      headers: { authorization: `Bearer ${tok}` },
      payload: {
        moodOverall: 7,
        events: [{ kind: 'bad', pillar: 'inexistente', intensity: 5, description: 'x' }],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('last-7-days returns entries only for days with a check-in', async () => {
    const tok = await makeAuthedUser();
    await app.inject({
      method: 'POST',
      url: '/checkins/today',
      headers: { authorization: `Bearer ${tok}` },
      payload: { moodOverall: 6 },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/checkins/last-7-days',
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json().checkins as { date: string; moodOverall: number | null }[];
    expect(rows).toHaveLength(7);
    const withMood = rows.filter((r) => r.moodOverall !== null);
    expect(withMood).toHaveLength(1);
    expect(withMood[0].moodOverall).toBe(6);
  });
});
