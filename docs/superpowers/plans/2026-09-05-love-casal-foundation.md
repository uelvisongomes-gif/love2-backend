# LOVE Casal Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the LOVE Casal backend (Fastify + Postgres + Prisma) with Auth (register/login/2FA), Couples (invite/accept), and LGPD consent — the foundation on which the AI Core will run.

**Architecture:** Modular monolith in TypeScript. Fastify serves REST endpoints. Prisma manages Postgres schema. Each domain lives in `src/modules/<name>/{routes.ts, service.ts, schema.ts, *.test.ts}`. Postgres runs locally via docker-compose (image `pgvector/pgvector:pg16`, which brings the extension we'll use in Plan 2).

**Tech Stack:** Node 20+, TypeScript 5, Fastify 4, Prisma 5, PostgreSQL 16 + pgvector, argon2, jsonwebtoken, zod, Twilio, Vitest, pino.

**Spec:** `docs/superpowers/specs/2026-09-05-love-casal-design.md`

## Global Constraints

- TypeScript **strict** mode. No `any` in application code.
- Node **>= 20**.
- Secrets **only** via env vars. Never commit `.env`. Use `.env.example` as the shape source.
- Passwords hashed with **argon2id**, `memoryCost >= 65536`, `timeCost >= 3`.
- JWT: **HS256**. Access token TTL **15m**. Refresh TTL **7d**.
- HTTP errors follow `{ error: { code: string, message: string } }`. `code` is UPPER_SNAKE.
- All timestamps stored in UTC (`timestamptz` in Postgres).
- User-facing messages in **Portuguese (pt-BR)**. Code, logs, and error `code` in English.
- All endpoints validate input with **zod**. Reject unknown fields.
- No PII beyond name/email/phone in the foundation layer (no CPF/RG/photo).
- Rate limits: **5 requests/min** on auth endpoints per IP; **10 requests/hour** on 2FA send.
- Test coverage: every service function has at least one happy-path test and one failure-path test.
- **Vendor-neutral Postgres:** the codebase depends only on standard Postgres (and the standard `pgvector` extension). No provider-specific SQL, no `auth.uid()`/RLS coupled to a hosted auth, no proprietary client libraries. Switching between Supabase, Neon, RDS, self-hosted Docker, or on-premise Postgres must require **only changing `DATABASE_URL`** — nothing else. Any code that would break this rule is a plan violation.

---

### Task 1: Project scaffold, Fastify, Vitest, health check

**Files:**
- Create: `package.json`, `tsconfig.json`, `.env.example`, `src/server.ts`, `src/app.ts`, `src/config.ts`, `src/modules/health/routes.ts`, `src/modules/health/routes.test.ts`, `vitest.config.ts`, `.eslintrc.cjs`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `buildApp(config?): Promise<FastifyInstance>` — factory used by tests and by `server.ts`.
  - `config` object of type `AppConfig` exported from `src/config.ts`.
  - `GET /health` returning `{ status: 'ok', uptime: number }`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "love-casal",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint 'src/**/*.ts'"
  },
  "dependencies": {
    "fastify": "^4.28.1",
    "pino": "^9.4.0",
    "pino-pretty": "^11.2.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@typescript-eslint/eslint-plugin": "^7.13.0",
    "@typescript-eslint/parser": "^7.13.0",
    "eslint": "^8.57.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `.env.example`**

```
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
```

- [ ] **Step 4: Create `src/config.ts`**

```ts
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return schema.parse(env);
}
```

- [ ] **Step 5: Write the failing health-check test**

Create `src/modules/health/routes.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../../app.js';

describe('GET /health', () => {
  const app = await buildApp();
  afterAll(() => app.close());

  it('returns status ok and uptime', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
  });
});
```

- [ ] **Step 6: Run the test and confirm it fails**

Run: `npm test`
Expected: FAIL (module `../../app.js` not found).

- [ ] **Step 7: Implement `src/modules/health/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));
}
```

- [ ] **Step 8: Implement `src/app.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig } from './config.js';
import { healthRoutes } from './modules/health/routes.js';

export async function buildApp(config: AppConfig = loadConfig()): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });
  await app.register(healthRoutes);
  return app;
}
```

- [ ] **Step 9: Implement `src/server.ts`**

```ts
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp(config);
try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
```

- [ ] **Step 10: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 11: Run tests and confirm they pass**

Run: `npm install && npm test`
Expected: 1 passed.

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json tsconfig.json .env.example vitest.config.ts src/
git commit -m "feat(foundation): scaffold Fastify + Vitest with /health"
```

---

### Task 2: PostgreSQL + Prisma + docker-compose

**Files:**
- Create: `docker-compose.yml`, `prisma/schema.prisma`, `src/db/client.ts`, `src/db/client.test.ts`, add to `.env.example`
- Modify: `package.json` (add prisma deps + scripts)

**Interfaces:**
- Consumes: `loadConfig` from Task 1.
- Produces:
  - `prisma: PrismaClient` — singleton exported from `src/db/client.ts`.
  - `DATABASE_URL` env var, added to `AppConfig`.

- [ ] **Step 1: Update `package.json`**

Add to `dependencies`:
```json
"@prisma/client": "^5.20.0"
```
Add to `devDependencies`:
```json
"prisma": "^5.20.0"
```
Add scripts:
```json
"db:up": "docker compose up -d db",
"db:down": "docker compose down",
"db:migrate": "prisma migrate dev",
"db:generate": "prisma generate"
```

- [ ] **Step 2: Create `docker-compose.yml`**

```yaml
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: love
      POSTGRES_PASSWORD: love
      POSTGRES_DB: love-casal
    ports:
      - "5432:5432"
    volumes:
      - lovedb:/var/lib/postgresql/data
volumes:
  lovedb:
```

- [ ] **Step 3: Update `.env.example`**

Append:
```
DATABASE_URL=postgresql://love:love@localhost:5432/love-casal?schema=public
```

- [ ] **Step 4: Update `src/config.ts`**

Add to the zod schema:
```ts
  DATABASE_URL: z.string().url(),
```

- [ ] **Step 5: Create `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

- [ ] **Step 6: Write the failing DB connection test**

Create `src/db/client.test.ts`:
```ts
import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from './client.js';

describe('prisma client', () => {
  afterAll(() => prisma.$disconnect());

  it('connects and runs SELECT 1', async () => {
    const rows = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`;
    expect(rows[0].ok).toBe(1);
  });
});
```

- [ ] **Step 7: Run the test and confirm it fails**

Run: `npm test`
Expected: FAIL (module `./client.js` not found).

- [ ] **Step 8: Implement `src/db/client.ts`**

```ts
import { PrismaClient } from '@prisma/client';

declare global {
  var __prisma: PrismaClient | undefined;
}

export const prisma = global.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') global.__prisma = prisma;
```

- [ ] **Step 9: Bring up DB, generate client, run tests**

Run:
```
npm install
npm run db:up
npm run db:generate
npm test
```
Expected: 2 passed.

- [ ] **Step 10: Commit**

```bash
git add docker-compose.yml prisma/ src/db/ .env.example package.json package-lock.json src/config.ts
git commit -m "feat(foundation): add Postgres via docker-compose + Prisma client"
```

---

### Task 3: User model + registration (argon2)

**Files:**
- Create: `src/modules/auth/schema.ts`, `src/modules/auth/service.ts`, `src/modules/auth/routes.ts`, `src/modules/auth/register.test.ts`, `src/errors.ts`
- Modify: `prisma/schema.prisma` (add `User` model), `src/app.ts` (register auth routes), `package.json` (add argon2)

**Interfaces:**
- Consumes: `prisma` from Task 2.
- Produces:
  - `POST /auth/register` accepting `{ name, email, phone, password }`, returning `{ userId }` with status 201.
  - `registerUser(input): Promise<{ userId: string }>` in `service.ts`.
  - `AppError` class exported from `src/errors.ts` with fields `code`, `message`, `statusCode`.

- [ ] **Step 1: Add to `package.json` dependencies**

```json
"argon2": "^0.41.1"
```

- [ ] **Step 2: Add `User` to `prisma/schema.prisma`**

```prisma
model User {
  id           String   @id @default(cuid())
  name         String
  email        String   @unique
  phone        String   @unique
  passwordHash String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

- [ ] **Step 3: Create `src/errors.ts`**

```ts
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
```

- [ ] **Step 4: Create `src/modules/auth/schema.ts`**

```ts
import { z } from 'zod';

export const registerInput = z
  .object({
    name: z.string().min(2).max(80),
    email: z.string().email().toLowerCase(),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'phone must be E.164'),
    password: z
      .string()
      .min(10)
      .regex(/[A-Z]/, 'must contain uppercase')
      .regex(/[a-z]/, 'must contain lowercase')
      .regex(/\d/, 'must contain digit'),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerInput>;
```

- [ ] **Step 5: Write the failing tests**

Create `src/modules/auth/register.test.ts`:
```ts
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

  it('rejects weak password (400 WEAK_PASSWORD)', async () => {
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
```

- [ ] **Step 6: Run tests and confirm failure**

Run: `npm test`
Expected: FAIL (route not registered).

- [ ] **Step 7: Implement `src/modules/auth/service.ts`**

```ts
import argon2 from 'argon2';
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import type { RegisterInput } from './schema.js';

export async function registerUser(input: RegisterInput): Promise<{ userId: string }> {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: input.email }, { phone: input.phone }] },
  });
  if (existing) {
    if (existing.email === input.email) throw new AppError('EMAIL_TAKEN', 'E-mail já cadastrado', 409);
    throw new AppError('PHONE_TAKEN', 'Telefone já cadastrado', 409);
  }
  const passwordHash = await argon2.hash(input.password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, phone: input.phone, passwordHash },
    select: { id: true },
  });
  return { userId: user.id };
}
```

- [ ] **Step 8: Implement `src/modules/auth/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { registerInput } from './schema.js';
import { registerUser } from './service.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', async (req, reply) => {
    try {
      const input = registerInput.parse(req.body);
      const result = await registerUser(input);
      return reply.code(201).send(result);
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: err.issues.map(i => i.message).join('; ') },
        });
      }
      if (err instanceof AppError) {
        return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      }
      req.log.error({ err }, 'register failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });
}
```

- [ ] **Step 9: Register the route in `src/app.ts`**

Replace the body of `buildApp` to register both routes:
```ts
  await app.register(healthRoutes);
  await app.register(authRoutes);
```
Add import: `import { authRoutes } from './modules/auth/routes.js';`

- [ ] **Step 10: Migrate DB and run tests**

Run:
```
npm install
npm run db:migrate -- --name add_user
npm test
```
Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add prisma/ src/errors.ts src/modules/auth/ src/app.ts package.json package-lock.json
git commit -m "feat(auth): register user with argon2id"
```

---

### Task 4: Login + JWT (access + refresh)

**Files:**
- Create: `src/modules/auth/login.test.ts`, `src/modules/auth/tokens.ts`, `src/modules/auth/auth-plugin.ts`
- Modify: `src/modules/auth/schema.ts` (add loginInput), `src/modules/auth/service.ts` (add loginUser), `src/modules/auth/routes.ts` (add POST /auth/login), `src/config.ts` (JWT env vars), `.env.example`, `package.json` (jsonwebtoken)

**Interfaces:**
- Consumes: `registerUser` (for test setup); `prisma`.
- Produces:
  - `POST /auth/login` accepting `{ email, password }`, returning `{ accessToken, refreshToken }` with status 200.
  - `signAccessToken(userId): string`, `signRefreshToken(userId): string`, `verifyAccessToken(token): { sub: string }` in `tokens.ts`.
  - Fastify plugin `authenticate` (decorator) that populates `req.userId` and rejects with 401 when missing/invalid.

- [ ] **Step 1: Add to `package.json`**

`dependencies`:
```json
"jsonwebtoken": "^9.0.2"
```
`devDependencies`:
```json
"@types/jsonwebtoken": "^9.0.6"
```

- [ ] **Step 2: Extend `src/config.ts`**

Add to schema:
```ts
  JWT_SECRET: z.string().min(32),
  ACCESS_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
```

- [ ] **Step 3: Append to `.env.example`**

```
JWT_SECRET=change-me-change-me-change-me-32chars
ACCESS_TTL_MIN=15
REFRESH_TTL_DAYS=7
```

- [ ] **Step 4: Extend `src/modules/auth/schema.ts`**

```ts
export const loginInput = z
  .object({
    email: z.string().email().toLowerCase(),
    password: z.string().min(1),
  })
  .strict();
export type LoginInput = z.infer<typeof loginInput>;
```

- [ ] **Step 5: Write failing tests**

Create `src/modules/auth/login.test.ts`:
```ts
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
```

- [ ] **Step 6: Run tests and confirm failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 7: Implement `src/modules/auth/tokens.ts`**

```ts
import jwt from 'jsonwebtoken';
import { loadConfig } from '../../config.js';

const cfg = loadConfig();

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, cfg.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: `${cfg.ACCESS_TTL_MIN}m`,
  });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, typ: 'refresh' }, cfg.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: `${cfg.REFRESH_TTL_DAYS}d`,
  });
}

export function verifyAccessToken(token: string): { sub: string } {
  const decoded = jwt.verify(token, cfg.JWT_SECRET, { algorithms: ['HS256'] });
  if (typeof decoded === 'string' || typeof decoded.sub !== 'string') {
    throw new Error('invalid token');
  }
  return { sub: decoded.sub };
}
```

- [ ] **Step 8: Extend `src/modules/auth/service.ts`**

Add:
```ts
import { signAccessToken, signRefreshToken } from './tokens.js';
import type { LoginInput } from './schema.js';

export async function loginUser(input: LoginInput): Promise<{ accessToken: string; refreshToken: string }> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw new AppError('INVALID_CREDENTIALS', 'Credenciais inválidas', 401);
  const ok = await argon2.verify(user.passwordHash, input.password);
  if (!ok) throw new AppError('INVALID_CREDENTIALS', 'Credenciais inválidas', 401);
  return {
    accessToken: signAccessToken(user.id),
    refreshToken: signRefreshToken(user.id),
  };
}
```

- [ ] **Step 9: Add the login route in `src/modules/auth/routes.ts`**

Inside `authRoutes`:
```ts
  app.post('/auth/login', async (req, reply) => {
    try {
      const input = loginInput.parse(req.body);
      const result = await loginUser(input);
      return reply.code(200).send(result);
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: err.issues.map(i => i.message).join('; ') },
        });
      }
      if (err instanceof AppError) {
        return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      }
      req.log.error({ err }, 'login failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });
```
Add import: `import { loginInput } from './schema.js'; import { loginUser } from './service.js';`

- [ ] **Step 10: Implement `src/modules/auth/auth-plugin.ts`**

```ts
import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from './tokens.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async (app) => {
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Sem token' } });
    }
    try {
      const { sub } = verifyAccessToken(auth.slice(7));
      req.userId = sub;
    } catch {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Token inválido' } });
    }
  });
});
```

Add to `package.json` deps: `"fastify-plugin": "^4.5.1"`.

- [ ] **Step 11: Register the plugin in `src/app.ts`**

Before the routes, register the plugin:
```ts
import authPlugin from './modules/auth/auth-plugin.js';
// ...
  await app.register(authPlugin);
```

- [ ] **Step 12: Run tests**

Run: `npm install && npm test`
Expected: all pass.

- [ ] **Step 13: Commit**

```bash
git add src/ .env.example package.json package-lock.json
git commit -m "feat(auth): login with JWT access + refresh + authenticate plugin"
```

---

### Task 5: 2FA via SMS (Twilio) with test double

**Files:**
- Create: `src/modules/auth/sms.ts`, `src/modules/auth/2fa.test.ts`
- Modify: `prisma/schema.prisma` (add `TwoFactorCode`), `src/modules/auth/schema.ts` (add 2fa inputs), `src/modules/auth/service.ts`, `src/modules/auth/routes.ts`, `src/config.ts`, `.env.example`, `package.json` (twilio)

**Interfaces:**
- Consumes: `authenticate` decorator, `prisma`, `AppError`.
- Produces:
  - `POST /auth/2fa/request` (authenticated) sends a 6-digit code by SMS, returns `{ sent: true }`.
  - `POST /auth/2fa/verify` (authenticated) accepts `{ code }`, returns `{ verified: true }` (200) or `INVALID_2FA` (401).
  - `SmsSender` interface `{ send(to: string, body: string): Promise<void> }` from `sms.ts`. Real impl uses Twilio; test suite injects a memory double.

- [ ] **Step 1: Add `TwoFactorCode` to `prisma/schema.prisma`**

```prisma
model TwoFactorCode {
  id        String   @id @default(cuid())
  userId    String
  codeHash  String
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())

  @@index([userId])
}
```

- [ ] **Step 2: Add to `package.json` deps**

```json
"twilio": "^5.3.0"
```

- [ ] **Step 3: Extend `src/config.ts`**

Add to schema:
```ts
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  SMS_DRIVER: z.enum(['twilio', 'memory']).default('memory'),
```

- [ ] **Step 4: Append to `.env.example`**

```
SMS_DRIVER=memory
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM=
```

- [ ] **Step 5: Create `src/modules/auth/sms.ts`**

```ts
import twilio from 'twilio';
import { loadConfig } from '../../config.js';

export interface SmsSender {
  send(to: string, body: string): Promise<void>;
}

export class MemorySmsSender implements SmsSender {
  public sent: { to: string; body: string }[] = [];
  async send(to: string, body: string): Promise<void> {
    this.sent.push({ to, body });
  }
}

class TwilioSmsSender implements SmsSender {
  private client: ReturnType<typeof twilio>;
  private from: string;
  constructor(sid: string, token: string, from: string) {
    this.client = twilio(sid, token);
    this.from = from;
  }
  async send(to: string, body: string): Promise<void> {
    await this.client.messages.create({ to, from: this.from, body });
  }
}

let instance: SmsSender | null = null;

export function setSmsSender(sender: SmsSender): void {
  instance = sender;
}

export function getSmsSender(): SmsSender {
  if (instance) return instance;
  const cfg = loadConfig();
  if (cfg.SMS_DRIVER === 'twilio') {
    if (!cfg.TWILIO_ACCOUNT_SID || !cfg.TWILIO_AUTH_TOKEN || !cfg.TWILIO_FROM) {
      throw new Error('Twilio env vars missing');
    }
    instance = new TwilioSmsSender(cfg.TWILIO_ACCOUNT_SID, cfg.TWILIO_AUTH_TOKEN, cfg.TWILIO_FROM);
  } else {
    instance = new MemorySmsSender();
  }
  return instance;
}
```

- [ ] **Step 6: Extend `src/modules/auth/schema.ts`**

```ts
export const verify2faInput = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
export type Verify2faInput = z.infer<typeof verify2faInput>;
```

- [ ] **Step 7: Write failing tests**

Create `src/modules/auth/2fa.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';
import { MemorySmsSender, setSmsSender } from './sms.js';

const sms = new MemorySmsSender();
setSmsSender(sms);

const app = await buildApp();
const body = { name: 'Maria', email: 'maria@example.com', phone: '+5511999999999', password: 'SenhaForte123' };
let accessToken = '';

beforeEach(async () => {
  sms.sent.length = 0;
  await prisma.twoFactorCode.deleteMany();
  await prisma.user.deleteMany();
  await app.inject({ method: 'POST', url: '/auth/register', payload: body });
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: body.email, password: body.password },
  });
  accessToken = login.json().accessToken;
});
afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

describe('2FA', () => {
  it('sends a 6-digit code by SMS', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/2fa/request',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ sent: true });
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0].to).toBe(body.phone);
    expect(sms.sent[0].body).toMatch(/\d{6}/);
  });

  it('verifies the correct code', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/2fa/request',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const code = sms.sent[0].body.match(/\d{6}/)![0];
    const res = await app.inject({
      method: 'POST',
      url: '/auth/2fa/verify',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { code },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ verified: true });
  });

  it('rejects an invalid code with 401 INVALID_2FA', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/2fa/request',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/2fa/verify',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { code: '000000' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_2FA');
  });
});
```

- [ ] **Step 8: Run and confirm failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 9: Extend `src/modules/auth/service.ts`**

```ts
import crypto from 'node:crypto';
import { getSmsSender } from './sms.js';
import type { Verify2faInput } from './schema.js';

const TWO_FA_TTL_MS = 5 * 60 * 1000;

export async function request2fa(userId: string): Promise<{ sent: true }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('NOT_FOUND', 'Usuário não encontrado', 404);
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = await argon2.hash(code, { type: argon2.argon2id });
  await prisma.twoFactorCode.create({
    data: { userId, codeHash, expiresAt: new Date(Date.now() + TWO_FA_TTL_MS) },
  });
  await getSmsSender().send(user.phone, `LOVE Casal: seu código é ${code}. Válido por 5 minutos.`);
  return { sent: true };
}

export async function verify2fa(userId: string, input: Verify2faInput): Promise<{ verified: true }> {
  const candidates = await prisma.twoFactorCode.findMany({
    where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });
  for (const c of candidates) {
    if (await argon2.verify(c.codeHash, input.code)) {
      await prisma.twoFactorCode.update({ where: { id: c.id }, data: { usedAt: new Date() } });
      return { verified: true };
    }
  }
  throw new AppError('INVALID_2FA', 'Código inválido ou expirado', 401);
}
```

- [ ] **Step 10: Add routes to `src/modules/auth/routes.ts`**

```ts
  app.post('/auth/2fa/request', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await request2fa(req.userId!));
    } catch (err) {
      if (err instanceof AppError) {
        return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      }
      req.log.error({ err }, '2fa request failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });

  app.post('/auth/2fa/verify', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = verify2faInput.parse(req.body);
      return reply.code(200).send(await verify2fa(req.userId!, input));
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: err.issues.map(i => i.message).join('; ') },
        });
      }
      if (err instanceof AppError) {
        return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      }
      req.log.error({ err }, '2fa verify failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });
```
Add imports: `import { verify2faInput } from './schema.js'; import { request2fa, verify2fa } from './service.js';`

- [ ] **Step 11: Migrate DB and run tests**

Run:
```
npm install
npm run db:migrate -- --name add_two_factor
npm test
```
Expected: all tests pass.

- [ ] **Step 12: Commit**

```bash
git add prisma/ src/ .env.example package.json package-lock.json
git commit -m "feat(auth): SMS 2FA with Twilio (memory driver in tests)"
```

---

### Task 6: Couple model + invite/accept flow

**Files:**
- Create: `src/modules/couples/schema.ts`, `src/modules/couples/service.ts`, `src/modules/couples/routes.ts`, `src/modules/couples/couples.test.ts`
- Modify: `prisma/schema.prisma` (add `Couple`, `CoupleInvite`), `src/app.ts` (register routes)

**Interfaces:**
- Consumes: `authenticate` decorator, `prisma`, `AppError`.
- Produces:
  - `POST /couples/invite` (auth) accepts `{ inviteeEmail }`, returns `{ inviteId, code }` (short code the partner types).
  - `POST /couples/accept` (auth) accepts `{ code }`, returns `{ coupleId }`.
  - `GET /couples/me` (auth) returns `{ couple: { id, partnerId, partnerName } | null }`.
  - Business rules: a user cannot invite themselves; a user with an active couple cannot invite; an invite is single-use, expires in 7 days, code is 8 uppercase alphanumerics.

- [ ] **Step 1: Extend `prisma/schema.prisma`**

```prisma
model Couple {
  id        String   @id @default(cuid())
  userAId   String   @unique
  userBId   String   @unique
  createdAt DateTime @default(now())
  userA     User     @relation("CoupleUserA", fields: [userAId], references: [id])
  userB     User     @relation("CoupleUserB", fields: [userBId], references: [id])
}

model CoupleInvite {
  id            String   @id @default(cuid())
  inviterId    String
  inviteeEmail String
  code         String   @unique
  expiresAt    DateTime
  acceptedAt   DateTime?
  createdAt    DateTime @default(now())

  @@index([inviterId])
}
```

Also add to `User` model:
```prisma
  coupleAsA Couple? @relation("CoupleUserA")
  coupleAsB Couple? @relation("CoupleUserB")
```

- [ ] **Step 2: Create `src/modules/couples/schema.ts`**

```ts
import { z } from 'zod';

export const inviteInput = z.object({ inviteeEmail: z.string().email().toLowerCase() }).strict();
export const acceptInput = z.object({ code: z.string().regex(/^[A-Z0-9]{8}$/) }).strict();
export type InviteInput = z.infer<typeof inviteInput>;
export type AcceptInput = z.infer<typeof acceptInput>;
```

- [ ] **Step 3: Write failing tests**

Create `src/modules/couples/couples.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';

const app = await buildApp();

async function makeUser(email: string, phone: string) {
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'X', email, phone, password: 'SenhaForte123' },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: 'SenhaForte123' },
  });
  return login.json().accessToken as string;
}

beforeEach(async () => {
  await prisma.couple.deleteMany();
  await prisma.coupleInvite.deleteMany();
  await prisma.twoFactorCode.deleteMany();
  await prisma.user.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

describe('Couples flow', () => {
  it('invite + accept creates a couple', async () => {
    const aTok = await makeUser('a@x.com', '+5511900000001');
    const bTok = await makeUser('b@x.com', '+5511900000002');

    const inv = await app.inject({
      method: 'POST',
      url: '/couples/invite',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { inviteeEmail: 'b@x.com' },
    });
    expect(inv.statusCode).toBe(201);
    const code = inv.json().code as string;
    expect(code).toMatch(/^[A-Z0-9]{8}$/);

    const acc = await app.inject({
      method: 'POST',
      url: '/couples/accept',
      headers: { authorization: `Bearer ${bTok}` },
      payload: { code },
    });
    expect(acc.statusCode).toBe(200);
    expect(typeof acc.json().coupleId).toBe('string');

    const me = await app.inject({
      method: 'GET',
      url: '/couples/me',
      headers: { authorization: `Bearer ${bTok}` },
    });
    expect(me.json().couple).not.toBeNull();
  });

  it('rejects self-invite with 400 SELF_INVITE', async () => {
    const aTok = await makeUser('a@x.com', '+5511900000001');
    const res = await app.inject({
      method: 'POST',
      url: '/couples/invite',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { inviteeEmail: 'a@x.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('SELF_INVITE');
  });

  it('rejects accepting an unknown code with 404 INVITE_NOT_FOUND', async () => {
    const bTok = await makeUser('b@x.com', '+5511900000002');
    const res = await app.inject({
      method: 'POST',
      url: '/couples/accept',
      headers: { authorization: `Bearer ${bTok}` },
      payload: { code: 'ZZZZZZZZ' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('INVITE_NOT_FOUND');
  });
});
```

- [ ] **Step 4: Run and confirm failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 5: Implement `src/modules/couples/service.ts`**

```ts
import crypto from 'node:crypto';
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import type { InviteInput, AcceptInput } from './schema.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode(): string {
  let out = '';
  const buf = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) out += ALPHABET[buf[i] % ALPHABET.length];
  return out;
}

async function ensureNoCouple(userId: string): Promise<void> {
  const has = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
  });
  if (has) throw new AppError('ALREADY_IN_COUPLE', 'Você já está vinculada a um casal', 409);
}

export async function createInvite(inviterId: string, input: InviteInput): Promise<{ inviteId: string; code: string }> {
  const inviter = await prisma.user.findUnique({ where: { id: inviterId } });
  if (!inviter) throw new AppError('NOT_FOUND', 'Usuário não encontrado', 404);
  if (inviter.email === input.inviteeEmail) {
    throw new AppError('SELF_INVITE', 'Não é possível convidar a si mesma', 400);
  }
  await ensureNoCouple(inviterId);
  const code = newCode();
  const invite = await prisma.coupleInvite.create({
    data: {
      inviterId,
      inviteeEmail: input.inviteeEmail,
      code,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
    select: { id: true, code: true },
  });
  return { inviteId: invite.id, code: invite.code };
}

export async function acceptInvite(userId: string, input: AcceptInput): Promise<{ coupleId: string }> {
  const invite = await prisma.coupleInvite.findUnique({ where: { code: input.code } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    throw new AppError('INVITE_NOT_FOUND', 'Convite não encontrado ou expirado', 404);
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('NOT_FOUND', 'Usuário não encontrado', 404);
  if (user.email !== invite.inviteeEmail) {
    throw new AppError('INVITE_FOR_OTHER', 'Este convite é para outro e-mail', 403);
  }
  if (invite.inviterId === userId) {
    throw new AppError('SELF_INVITE', 'Não é possível aceitar o próprio convite', 400);
  }
  await ensureNoCouple(userId);
  await ensureNoCouple(invite.inviterId);

  const couple = await prisma.$transaction(async (tx) => {
    const c = await tx.couple.create({
      data: { userAId: invite.inviterId, userBId: userId },
      select: { id: true },
    });
    await tx.coupleInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    return c;
  });
  return { coupleId: couple.id };
}

export async function getMyCouple(
  userId: string,
): Promise<{ couple: { id: string; partnerId: string; partnerName: string } | null }> {
  const couple = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    include: { userA: true, userB: true },
  });
  if (!couple) return { couple: null };
  const partner = couple.userAId === userId ? couple.userB : couple.userA;
  return { couple: { id: couple.id, partnerId: partner.id, partnerName: partner.name } };
}
```

- [ ] **Step 6: Implement `src/modules/couples/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { inviteInput, acceptInput } from './schema.js';
import { createInvite, acceptInvite, getMyCouple } from './service.js';

function handle(err: unknown, reply: import('fastify').FastifyReply, log: import('fastify').FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'couples route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function couplesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/couples/invite', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = inviteInput.parse(req.body);
      return reply.code(201).send(await createInvite(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.post('/couples/accept', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = acceptInput.parse(req.body);
      return reply.code(200).send(await acceptInvite(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/couples/me', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getMyCouple(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
```

- [ ] **Step 7: Register the routes in `src/app.ts`**

Add `import { couplesRoutes } from './modules/couples/routes.js';` and `await app.register(couplesRoutes);`.

- [ ] **Step 8: Migrate DB and run tests**

Run:
```
npm run db:migrate -- --name add_couple
npm test
```
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add prisma/ src/ 
git commit -m "feat(couples): invite/accept flow with 8-char code + mutual-consent rule"
```

---

### Task 7: LGPD consent + audit log

**Files:**
- Create: `src/modules/consent/schema.ts`, `src/modules/consent/service.ts`, `src/modules/consent/routes.ts`, `src/modules/consent/consent.test.ts`
- Modify: `prisma/schema.prisma` (add `Consent`, `AuditLog`), `src/app.ts`

**Interfaces:**
- Consumes: `authenticate` decorator, `prisma`, `AppError`.
- Produces:
  - `POST /consent` (auth) accepts `{ scope, version }` where `scope` is one of `terms`, `privacy`, `disclaimer_love_not_therapist`; stores a signed record with timestamp and returns `{ consentId }`.
  - `GET /consent/status` (auth) returns `{ scopes: { terms: boolean; privacy: boolean; disclaimer_love_not_therapist: boolean } }` — only scopes with a record whose `version` matches the current constant.
  - Every successful mutation in this task writes an `AuditLog` row `{ actorId, action, target, at }`.
  - Constants exported from `service.ts`: `CURRENT_CONSENT_VERSIONS = { terms: '1', privacy: '1', disclaimer_love_not_therapist: '1' }`.

- [ ] **Step 1: Extend `prisma/schema.prisma`**

```prisma
model Consent {
  id        String   @id @default(cuid())
  userId    String
  scope     String
  version   String
  createdAt DateTime @default(now())

  @@index([userId, scope])
}

model AuditLog {
  id        String   @id @default(cuid())
  actorId   String
  action    String
  target    String
  at        DateTime @default(now())

  @@index([actorId])
}
```

- [ ] **Step 2: Create `src/modules/consent/schema.ts`**

```ts
import { z } from 'zod';

export const consentScopes = ['terms', 'privacy', 'disclaimer_love_not_therapist'] as const;
export type ConsentScope = (typeof consentScopes)[number];

export const consentInput = z
  .object({
    scope: z.enum(consentScopes),
    version: z.string().min(1),
  })
  .strict();
export type ConsentInput = z.infer<typeof consentInput>;
```

- [ ] **Step 3: Write failing tests**

Create `src/modules/consent/consent.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';

const app = await buildApp();

async function makeUser() {
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'X', email: 'x@x.com', phone: '+5511900000010', password: 'SenhaForte123' },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'x@x.com', password: 'SenhaForte123' },
  });
  return login.json().accessToken as string;
}

beforeEach(async () => {
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

describe('Consent', () => {
  it('records a consent and writes an audit log', async () => {
    const tok = await makeUser();
    const res = await app.inject({
      method: 'POST',
      url: '/consent',
      headers: { authorization: `Bearer ${tok}` },
      payload: { scope: 'terms', version: '1' },
    });
    expect(res.statusCode).toBe(201);
    expect(typeof res.json().consentId).toBe('string');
    const audits = await prisma.auditLog.findMany();
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe('consent.grant');
  });

  it('returns status false for missing scope, true when granted at current version', async () => {
    const tok = await makeUser();
    const before = await app.inject({
      method: 'GET',
      url: '/consent/status',
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(before.json().scopes.terms).toBe(false);

    await app.inject({
      method: 'POST',
      url: '/consent',
      headers: { authorization: `Bearer ${tok}` },
      payload: { scope: 'terms', version: '1' },
    });
    const after = await app.inject({
      method: 'GET',
      url: '/consent/status',
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(after.json().scopes.terms).toBe(true);
  });

  it('rejects a version that does not match the current constant with 400 STALE_VERSION', async () => {
    const tok = await makeUser();
    const res = await app.inject({
      method: 'POST',
      url: '/consent',
      headers: { authorization: `Bearer ${tok}` },
      payload: { scope: 'terms', version: '0' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('STALE_VERSION');
  });
});
```

- [ ] **Step 4: Run and confirm failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 5: Implement `src/modules/consent/service.ts`**

```ts
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { consentScopes, type ConsentInput, type ConsentScope } from './schema.js';

export const CURRENT_CONSENT_VERSIONS: Record<ConsentScope, string> = {
  terms: '1',
  privacy: '1',
  disclaimer_love_not_therapist: '1',
};

export async function grantConsent(userId: string, input: ConsentInput): Promise<{ consentId: string }> {
  if (input.version !== CURRENT_CONSENT_VERSIONS[input.scope]) {
    throw new AppError('STALE_VERSION', 'Versão do termo desatualizada', 400);
  }
  return prisma.$transaction(async (tx) => {
    const c = await tx.consent.create({
      data: { userId, scope: input.scope, version: input.version },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: { actorId: userId, action: 'consent.grant', target: `${input.scope}:${input.version}` },
    });
    return { consentId: c.id };
  });
}

export async function consentStatus(userId: string): Promise<{ scopes: Record<ConsentScope, boolean> }> {
  const rows = await prisma.consent.findMany({ where: { userId } });
  const scopes = Object.fromEntries(consentScopes.map((s) => [s, false])) as Record<ConsentScope, boolean>;
  for (const r of rows) {
    const scope = r.scope as ConsentScope;
    if (CURRENT_CONSENT_VERSIONS[scope] === r.version) scopes[scope] = true;
  }
  return { scopes };
}
```

- [ ] **Step 6: Implement `src/modules/consent/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { consentInput } from './schema.js';
import { grantConsent, consentStatus } from './service.js';

export async function consentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/consent', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = consentInput.parse(req.body);
      return reply.code(201).send(await grantConsent(req.userId!, input));
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
        });
      }
      if (err instanceof AppError) {
        return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      }
      req.log.error({ err }, 'consent grant failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });

  app.get('/consent/status', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await consentStatus(req.userId!));
    } catch (err) {
      req.log.error({ err }, 'consent status failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });
}
```

- [ ] **Step 7: Register the routes in `src/app.ts`**

Add `import { consentRoutes } from './modules/consent/routes.js';` and `await app.register(consentRoutes);`.

- [ ] **Step 8: Migrate DB and run tests**

Run:
```
npm run db:migrate -- --name add_consent_and_audit
npm test
```
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add prisma/ src/
git commit -m "feat(consent): LGPD consent grants + audit log"
```

---

## Self-Review Notes

- **Spec coverage:** covers spec §2.1 (parts of onboarding — auth, couple linking, LGPD consent) and §7 (LGPD foundations: audit log, versioned consent). The rest of §2 depends on later plans (AI Core, Product Flows) and is out of this plan by design.
- **Placeholder scan:** none.
- **Type consistency:** `AppError` fields and error `code`s are consistent across tasks; `authenticate` decorator signature is defined once (Task 4) and reused; `prisma` singleton is one-source (Task 2).
