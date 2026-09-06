import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';

const app = await buildApp();
const body = { name: 'Maria', email: 'maria@example.com', phone: '+5511999999999', password: 'SenhaForte123' };

beforeEach(async () => {
  await prisma.user.deleteMany();
  await app.inject({ method: 'POST', url: '/auth/register', payload: body });
});
afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

describe('POST /auth/login', () => {
  it('returns access and refresh tokens for valid credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: body.email, password: body.password },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(typeof json.accessToken).toBe('string');
    expect(typeof json.refreshToken).toBe('string');
  });

  it('rejects wrong password with 401 INVALID_CREDENTIALS', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: body.email, password: 'ErradaTotalmente1' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects unknown email with 401 INVALID_CREDENTIALS', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nao-existe@example.com', password: 'Qualquer123X' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_CREDENTIALS');
  });
});
