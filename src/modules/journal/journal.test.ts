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

beforeEach(async () => {
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

describe('Journal', () => {
  it('creates, lists, updates, and deletes entries', async () => {
    const tok = await makeAuthedUser('j@x.com', '+5511900000040');
    const create = await app.inject({
      method: 'POST',
      url: '/journal',
      headers: { authorization: `Bearer ${tok}` },
      payload: { title: 'Dia difícil', content: 'Me senti sozinha', mood: 3 },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().id;

    const list = await app.inject({
      method: 'GET',
      url: '/journal',
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(list.json().entries).toHaveLength(1);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/journal/${id}`,
      headers: { authorization: `Bearer ${tok}` },
      payload: { mood: 7 },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().mood).toBe(7);

    const del = await app.inject({
      method: 'DELETE',
      url: `/journal/${id}`,
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(del.statusCode).toBe(204);
  });

  it("does NOT expose another user's entry (404, not 403)", async () => {
    const aTok = await makeAuthedUser('a@x.com', '+5511900000041');
    const bTok = await makeAuthedUser('b@x.com', '+5511900000042');
    const create = await app.inject({
      method: 'POST',
      url: '/journal',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { title: 'Meu diário', content: 'privado' },
    });
    const aId = create.json().id;

    const res = await app.inject({
      method: 'GET',
      url: `/journal/${aId}`,
      headers: { authorization: `Bearer ${bTok}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
