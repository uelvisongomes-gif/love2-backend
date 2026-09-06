import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';

const app = await buildApp();

async function makeAuthedUser(email = 'p@x.com', phone = '+5511900000030') {
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

const fullProfile = {
  loveLanguagesRanking: [
    'palavras_afirmacao',
    'tempo_qualidade',
    'toque_fisico',
    'atos_servico',
    'presentes',
  ],
  pillarScores: {
    financeiro: 7,
    comunicacao: 6,
    intimidade: 8,
    filhos: 5,
    tarefas: 4,
    papeis: 7,
    espiritualidade: 6,
  },
  preferences: {
    religion: 'cristianismo',
    religionOptIn: true,
    politicsOptIn: false,
    avoidedTopics: ['espiritualidade'],
  },
  relationshipYears: 5,
  hasChildren: true,
  livingTogether: true,
  timezone: 'America/Sao_Paulo',
};

describe('Profile', () => {
  it('creates profile via PUT and reads via GET', async () => {
    const tok = await makeAuthedUser();
    const put = await app.inject({
      method: 'PUT',
      url: '/profile',
      headers: { authorization: `Bearer ${tok}` },
      payload: fullProfile,
    });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: '/profile',
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(get.statusCode).toBe(200);
    const body = get.json();
    expect(body.pillarScores.comunicacao).toBe(6);
    expect(body.loveLanguagesRanking[0]).toBe('palavras_afirmacao');
  });

  it('GET returns 404 before any profile exists', async () => {
    const tok = await makeAuthedUser();
    const res = await app.inject({
      method: 'GET',
      url: '/profile',
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects malformed love-languages ranking (400)', async () => {
    const tok = await makeAuthedUser();
    const res = await app.inject({
      method: 'PUT',
      url: '/profile',
      headers: { authorization: `Bearer ${tok}` },
      payload: {
        loveLanguagesRanking: ['palavras_afirmacao', 'palavras_afirmacao', 'toque_fisico', 'atos_servico', 'presentes'],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('allowed-topics excludes items in avoidedTopics', async () => {
    const tok = await makeAuthedUser();
    await app.inject({
      method: 'PUT',
      url: '/profile',
      headers: { authorization: `Bearer ${tok}` },
      payload: fullProfile,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/profile/allowed-topics',
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(res.statusCode).toBe(200);
    const list: string[] = res.json().allowedTopics;
    expect(list).not.toContain('espiritualidade');
    expect(list).toContain('financeiro');
    expect(list).toContain('comunicacao');
  });
});
