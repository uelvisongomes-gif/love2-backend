import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from './client.js';

describe('prisma client', () => {
  afterAll(() => prisma.$disconnect());

  it('connects and runs SELECT 1', async () => {
    const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`;
    expect(rows[0].ok).toBe(1);
  });
});
