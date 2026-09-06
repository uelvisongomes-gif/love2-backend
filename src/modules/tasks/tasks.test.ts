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

async function pairCouple(): Promise<{ aTok: string; bTok: string }> {
  const aTok = await makeAuthedUser('a@x.com', '+5511900000050');
  const bTok = await makeAuthedUser('b@x.com', '+5511900000051');
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

describe('Couple tasks', () => {
  it('creates a task and both partners see it', async () => {
    const { aTok, bTok } = await pairCouple();
    const create = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { pillar: 'financeiro', title: 'Revisar orçamento do mês' },
    });
    expect(create.statusCode).toBe(201);
    const id = create.json().id;

    for (const tok of [aTok, bTok]) {
      const list = await app.inject({
        method: 'GET',
        url: '/tasks',
        headers: { authorization: `Bearer ${tok}` },
      });
      expect(list.json().tasks.some((t: { id: string }) => t.id === id)).toBe(true);
    }
  });

  it('sets completedAt only when BOTH mark done', async () => {
    const { aTok, bTok } = await pairCouple();
    const create = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { pillar: 'comunicacao', title: 'Conversar 15 min sem celular' },
    });
    const id = create.json().id;

    await app.inject({
      method: 'POST',
      url: `/tasks/${id}/complete`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    let task = await prisma.coupleTask.findUnique({ where: { id } });
    expect(task!.completedAt).toBeNull();

    await app.inject({
      method: 'POST',
      url: `/tasks/${id}/complete`,
      headers: { authorization: `Bearer ${bTok}` },
    });
    task = await prisma.coupleTask.findUnique({ where: { id } });
    expect(task!.completedAt).not.toBeNull();
  });

  it('rejects task creation without a couple (403 NO_COUPLE)', async () => {
    const tok = await makeAuthedUser('solo@x.com', '+5511900000052');
    const res = await app.inject({
      method: 'POST',
      url: '/tasks',
      headers: { authorization: `Bearer ${tok}` },
      payload: { pillar: 'financeiro', title: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NO_COUPLE');
  });
});
