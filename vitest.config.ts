import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    // All test files hit the same Postgres via Prisma; parallel execution
    // races on deleteMany/create. Serialize to a single worker.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    // Tests hit remote Supabase + real LLM — round-trip latency stacks up.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
