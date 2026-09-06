import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';

const app = await buildApp();

beforeEach(async () => {
  await prisma.user.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

const validBody = {
  name: 'Maria',
  email: 'maria@example.com',
  phone: '+5511999999999',
  password: 'SenhaForte123',
};

describe('POST /auth/register', () => {
  it('creates a user (201) and returns userId', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: validBody });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toHaveProperty('userId');
    const stored = await prisma.user.findUnique({ where: { email: validBody.email } });
    expect(stored).not.toBeNull();
    expect(stored!.passwordHash).not.toBe(validBody.password);
  });

  it('rejects weak password (400 VALIDATION_ERROR)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...validBody, password: 'weak' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects duplicate email (409 EMAIL_TAKEN)', async () => {
    await app.inject({ method: 'POST', url: '/auth/register', payload: validBody });
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: validBody });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('EMAIL_TAKEN');
  });
});
