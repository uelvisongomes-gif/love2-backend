# LOVE Casal Product Flows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the daily-use surface of LOVE Casal. Adds user-facing product flows: onboarding profile (love languages, 7-pillar self-rating, topic preferences), safety screening, daily check-in, private journal, shared couple tasks, and a basic health index. All of these feed the AI Orchestrator built in Plan 2.

**Architecture:** Same modular monolith pattern. New modules under `src/modules/`: `profile`, `checkins`, `journal`, `tasks`, `health`. Each follows `{routes.ts, service.ts, schema.ts, *.test.ts}`. New Prisma models: `Profile`, `SafetyScreening`, `CheckIn`, `Event`, `JournalEntry`, `Task`, `HealthScore`. Data segregation is enforced at the service layer — `Journal` and `CheckIn` are strictly per-user; `Task` and `HealthScore` operate at the couple level and require a Couple to exist.

**Tech Stack:** Same as Foundation + AI Core (Node 20, TypeScript, Fastify, Prisma, Postgres, Vitest). No new third-party dependencies expected.

**Spec:** `docs/superpowers/specs/2026-09-05-love-casal-design.md`

## Global Constraints

- **All Foundation and AI Core Global Constraints apply.**
- **Data segregation invariants:**
  - `JournalEntry` and `CheckIn` are **isolated by user**. No endpoint returns another user's rows, not even the partner's. Every read query filters by `userId = req.userId`.
  - `Task` and `HealthScore` operate at the **couple level**: both partners can read/write tasks; the health index is computed from the couple's data. But the CheckIn/Journal rows that feed the index remain individually-owned; the index aggregates them without exposing them.
- **Consent gate for AI-touched flows:** any flow whose data goes to LOVE (initially, that's `POST /love/chat` — but check-ins may feed into it later) already has the disclaimer consent gate from Plan 2. This plan does not repeat the gate; new endpoints in this plan are pure data endpoints (no LLM call), so they only require authentication.
- **Safety screening result affects Plan 4:** the `SafetyScreening` created here (positive violence / suicide flags) will later be checked by the ponte flow to route users to "modo cuidado" instead of standard mediation. This plan lands the data model + endpoint; consumers arrive in Plan 4.
- **Timestamps** in UTC; date-boundaries for "today" use the user's timezone from profile (default `America/Sao_Paulo`).
- **Test isolation** same as Foundation — Vitest single-fork, shared Supabase Postgres, `deleteMany` in `beforeEach`.

---

### Task 1: Profile onboarding — love languages + 7 pillars + preferences

**Files:**
- Create: `src/modules/profile/schema.ts`, `src/modules/profile/service.ts`, `src/modules/profile/routes.ts`, `src/modules/profile/profile.test.ts`
- Modify: `prisma/schema.prisma` (add `Profile`), migration, `src/app.ts` (register)

**Interfaces:**
- Consumes: `authenticate` decorator, `prisma`, `AppError`.
- Produces:
  - `Profile` model 1:1 with User: `loveLanguagesRanking` (Json — array of 5 items ordered), `pillarScores` (Json — record `{financeiro, comunicacao, intimidade, filhos, tarefas, papeis, espiritualidade}` each 0-10), `preferences` (Json — `{religion: string|null, religionOptIn: boolean, politicsOptIn: boolean, avoidedTopics: string[]}`), `relationshipYears`, `hasChildren`, `livingTogether`, `timezone`.
  - `PUT /profile` (auth) accepts partial profile update; creates row if missing.
  - `GET /profile` (auth) returns current profile or 404 if not created.
  - `GET /profile/allowed-topics` (auth) returns the string array LOVE will use as `allowedTopics` (7 pillar slugs minus those the user removed via `avoidedTopics`).

- [ ] **Step 1: Add `Profile` to `prisma/schema.prisma`**

```prisma
model Profile {
  id                    String   @id @default(cuid())
  userId                String   @unique
  loveLanguagesRanking  Json?
  pillarScores          Json?
  preferences           Json?
  relationshipYears     Int?
  hasChildren           Boolean?
  livingTogether        Boolean?
  timezone              String   @default("America/Sao_Paulo")
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}
```

- [ ] **Step 2: Create `src/modules/profile/schema.ts`**

```ts
import { z } from 'zod';

export const LOVE_LANGUAGES = [
  'palavras_afirmacao',
  'tempo_qualidade',
  'presentes',
  'atos_servico',
  'toque_fisico',
] as const;
export const PILLARS = [
  'financeiro',
  'comunicacao',
  'intimidade',
  'filhos',
  'tarefas',
  'papeis',
  'espiritualidade',
] as const;

const pillarScore = z.number().min(0).max(10);
const pillarScores = z.object({
  financeiro: pillarScore,
  comunicacao: pillarScore,
  intimidade: pillarScore,
  filhos: pillarScore,
  tarefas: pillarScore,
  papeis: pillarScore,
  espiritualidade: pillarScore,
});

const loveLanguagesRanking = z.array(z.enum(LOVE_LANGUAGES)).length(5).refine(
  (arr) => new Set(arr).size === 5,
  { message: 'love languages ranking must contain each of the 5 values exactly once' },
);

const preferences = z.object({
  religion: z.string().max(40).nullable(),
  religionOptIn: z.boolean(),
  politicsOptIn: z.boolean(),
  avoidedTopics: z.array(z.enum(PILLARS)).default([]),
});

export const upsertProfileInput = z
  .object({
    loveLanguagesRanking: loveLanguagesRanking.optional(),
    pillarScores: pillarScores.optional(),
    preferences: preferences.optional(),
    relationshipYears: z.number().int().min(0).max(80).optional(),
    hasChildren: z.boolean().optional(),
    livingTogether: z.boolean().optional(),
    timezone: z.string().optional(),
  })
  .strict();
export type UpsertProfileInput = z.infer<typeof upsertProfileInput>;
```

- [ ] **Step 3: Write the failing test**

Create `src/modules/profile/profile.test.ts`:
```ts
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
```

- [ ] **Step 4: Run and confirm failure**

Run: `npm test`
Expected: FAIL (no /profile routes).

- [ ] **Step 5: Implement `src/modules/profile/service.ts`**

```ts
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { PILLARS, type UpsertProfileInput } from './schema.js';

interface Preferences {
  religion: string | null;
  religionOptIn: boolean;
  politicsOptIn: boolean;
  avoidedTopics: string[];
}

export async function upsertProfile(userId: string, input: UpsertProfileInput): Promise<void> {
  await prisma.profile.upsert({
    where: { userId },
    create: { userId, ...input },
    update: input,
  });
}

export async function getProfile(userId: string) {
  const p = await prisma.profile.findUnique({ where: { userId } });
  if (!p) throw new AppError('PROFILE_NOT_FOUND', 'Perfil ainda não preenchido', 404);
  return p;
}

export async function getAllowedTopics(userId: string): Promise<{ allowedTopics: string[] }> {
  const p = await prisma.profile.findUnique({ where: { userId } });
  const avoided = new Set<string>();
  if (p?.preferences) {
    const prefs = p.preferences as unknown as Preferences;
    for (const t of prefs.avoidedTopics ?? []) avoided.add(t);
    if (!prefs.religionOptIn) avoided.add('espiritualidade');
  }
  return { allowedTopics: PILLARS.filter((t) => !avoided.has(t)) };
}
```

- [ ] **Step 6: Implement `src/modules/profile/routes.ts`**

```ts
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { upsertProfileInput } from './schema.js';
import { getAllowedTopics, getProfile, upsertProfile } from './service.js';

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'profile route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.put('/profile', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = upsertProfileInput.parse(req.body);
      await upsertProfile(req.userId!, input);
      return reply.code(200).send({ ok: true });
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/profile', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getProfile(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/profile/allowed-topics', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getAllowedTopics(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
```

- [ ] **Step 7: Register in `src/app.ts`**

Add `import { profileRoutes } from './modules/profile/routes.js';` and `await app.register(profileRoutes);`.

- [ ] **Step 8: Migrate and run tests**

Run:
```
npx prisma migrate dev --name add_profile
npm test
```
Expected: 4 new tests pass.

- [ ] **Step 9: Commit**

```bash
git add prisma/ src/modules/profile/ src/app.ts
git commit -m "feat(profile): onboarding — love languages, 7-pillar scores, topic prefs, timezone"
```

---

### Task 2: Safety screening endpoint

**Files:**
- Create: `src/modules/profile/safety-screening.ts` (service + route additions in the profile module — keeps onboarding surface together), `src/modules/profile/safety-screening.test.ts`
- Modify: `prisma/schema.prisma` (add `SafetyScreening`), migration, `src/modules/profile/routes.ts` (add screening endpoint)

**Interfaces:**
- Consumes: `authenticate`, `prisma`, `AppError`.
- Produces:
  - `SafetyScreening` model 1:1 with User: booleans for `hasViolenceHistory`, `hasSuicidalIdeation`, `hasSubstanceAbuse`, `hasChildSafetyConcerns`, plus `createdAt`.
  - `POST /profile/safety-screening` (auth) accepts the four booleans; upserts. Response indicates whether "care mode" is active (any true → care mode).
  - `GET /profile/safety-screening` (auth) returns current screening (or 404).
  - `careModeActive(userId): Promise<boolean>` — exported helper, used by Plan 4 to gate the ponte.

- [ ] **Step 1: Add `SafetyScreening` to `prisma/schema.prisma`**

```prisma
model SafetyScreening {
  id                        String   @id @default(cuid())
  userId                    String   @unique
  hasViolenceHistory        Boolean
  hasSuicidalIdeation       Boolean
  hasSubstanceAbuse         Boolean
  hasChildSafetyConcerns    Boolean
  createdAt                 DateTime @default(now())
  updatedAt                 DateTime @updatedAt
}
```

- [ ] **Step 2: Create `src/modules/profile/safety-screening.ts`**

```ts
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';

export const safetyScreeningInput = z
  .object({
    hasViolenceHistory: z.boolean(),
    hasSuicidalIdeation: z.boolean(),
    hasSubstanceAbuse: z.boolean(),
    hasChildSafetyConcerns: z.boolean(),
  })
  .strict();
export type SafetyScreeningInput = z.infer<typeof safetyScreeningInput>;

export async function submitSafetyScreening(
  userId: string,
  input: SafetyScreeningInput,
): Promise<{ careModeActive: boolean }> {
  await prisma.safetyScreening.upsert({
    where: { userId },
    create: { userId, ...input },
    update: input,
  });
  return { careModeActive: careModeFromInput(input) };
}

export async function getSafetyScreening(userId: string) {
  const s = await prisma.safetyScreening.findUnique({ where: { userId } });
  if (!s) throw new AppError('SCREENING_NOT_FOUND', 'Triagem não realizada', 404);
  return s;
}

export async function careModeActive(userId: string): Promise<boolean> {
  const s = await prisma.safetyScreening.findUnique({ where: { userId } });
  if (!s) return false;
  return careModeFromInput(s);
}

function careModeFromInput(
  s: Pick<SafetyScreeningInput, 'hasViolenceHistory' | 'hasSuicidalIdeation' | 'hasSubstanceAbuse' | 'hasChildSafetyConcerns'>,
): boolean {
  return (
    s.hasViolenceHistory ||
    s.hasSuicidalIdeation ||
    s.hasSubstanceAbuse ||
    s.hasChildSafetyConcerns
  );
}
```

- [ ] **Step 3: Write the failing test**

Create `src/modules/profile/safety-screening.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';
import { careModeActive } from './safety-screening.js';

const app = await buildApp();

async function makeAuthedUser() {
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Xx', email: 's@x.com', phone: '+5511900000031', password: 'SenhaForte123' },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 's@x.com', password: 'SenhaForte123' },
  });
  return { token: login.json().accessToken as string, userId: '' };
}

beforeEach(async () => {
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

describe('Safety screening', () => {
  it('stores screening and returns careModeActive=false for all-negative', async () => {
    const { token } = await makeAuthedUser();
    const res = await app.inject({
      method: 'POST',
      url: '/profile/safety-screening',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        hasViolenceHistory: false,
        hasSuicidalIdeation: false,
        hasSubstanceAbuse: false,
        hasChildSafetyConcerns: false,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ careModeActive: false });
  });

  it('flags careModeActive=true when any concern is true', async () => {
    const { token } = await makeAuthedUser();
    const res = await app.inject({
      method: 'POST',
      url: '/profile/safety-screening',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        hasViolenceHistory: true,
        hasSuicidalIdeation: false,
        hasSubstanceAbuse: false,
        hasChildSafetyConcerns: false,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ careModeActive: true });

    const user = await prisma.user.findFirst();
    expect(await careModeActive(user!.id)).toBe(true);
  });

  it('GET returns 404 before submission', async () => {
    const { token } = await makeAuthedUser();
    const res = await app.inject({
      method: 'GET',
      url: '/profile/safety-screening',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 4: Run and confirm failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 5: Add routes in `src/modules/profile/routes.ts`**

Add imports:
```ts
import { safetyScreeningInput, submitSafetyScreening, getSafetyScreening } from './safety-screening.js';
```

Inside `profileRoutes`:
```ts
  app.post('/profile/safety-screening', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = safetyScreeningInput.parse(req.body);
      return reply.code(200).send(await submitSafetyScreening(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/profile/safety-screening', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getSafetyScreening(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
```

- [ ] **Step 6: Migrate and run tests**

Run:
```
npx prisma migrate dev --name add_safety_screening
npm test
```
Expected: 3 new tests pass.

- [ ] **Step 7: Commit**

```bash
git add prisma/ src/modules/profile/
git commit -m "feat(profile): safety screening (violence/suicide/substance/child) + careModeActive helper"
```

---

### Task 3: Check-in diário

**Files:**
- Create: `src/modules/checkins/schema.ts`, `src/modules/checkins/service.ts`, `src/modules/checkins/routes.ts`, `src/modules/checkins/checkins.test.ts`
- Modify: `prisma/schema.prisma` (add `CheckIn` + `Event`), migration, `src/app.ts`

**Interfaces:**
- Consumes: `authenticate`, `prisma`, `AppError`, `PILLARS` from `profile/schema.ts`.
- Produces:
  - `CheckIn` model: one per day per user (unique on `userId + date`).
  - `Event` model: attached to a check-in; `kind: 'good' | 'bad'`, `pillar`, `intensity` (1-10), `description`.
  - `POST /checkins/today` accepts `{ moodOverall: 1-10, events?: Array<{kind, pillar, intensity, description}>, intimacyToday?: boolean, dateNightToday?: boolean }`. Upserts today's check-in for the user (in their profile timezone).
  - `GET /checkins/last-7-days` returns array of 7 daily rows (fills missing days as null).

- [ ] **Step 1: Add `CheckIn` and `Event` to `prisma/schema.prisma`**

```prisma
model CheckIn {
  id              String   @id @default(cuid())
  userId          String
  date            DateTime @db.Date
  moodOverall     Int
  intimacyToday   Boolean  @default(false)
  dateNightToday  Boolean  @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  events          Event[]

  @@unique([userId, date])
  @@index([userId, date])
}

model Event {
  id          String  @id @default(cuid())
  checkInId   String
  kind        String  // 'good' | 'bad'
  pillar      String
  intensity   Int
  description String
  checkIn     CheckIn @relation(fields: [checkInId], references: [id], onDelete: Cascade)

  @@index([checkInId])
}
```

- [ ] **Step 2: Create `src/modules/checkins/schema.ts`**

```ts
import { z } from 'zod';
import { PILLARS } from '../profile/schema.js';

const event = z.object({
  kind: z.enum(['good', 'bad']),
  pillar: z.enum(PILLARS),
  intensity: z.number().int().min(1).max(10),
  description: z.string().min(1).max(500),
});

export const checkinTodayInput = z
  .object({
    moodOverall: z.number().int().min(1).max(10),
    events: z.array(event).max(20).default([]),
    intimacyToday: z.boolean().default(false),
    dateNightToday: z.boolean().default(false),
  })
  .strict();
export type CheckinTodayInput = z.infer<typeof checkinTodayInput>;
```

- [ ] **Step 3: Write the failing test**

Create `src/modules/checkins/checkins.test.ts`:
```ts
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
```

- [ ] **Step 4: Run and confirm failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 5: Implement `src/modules/checkins/service.ts`**

```ts
import { prisma } from '../../db/client.js';
import type { CheckinTodayInput } from './schema.js';

async function userTimezone(userId: string): Promise<string> {
  const p = await prisma.profile.findUnique({ where: { userId }, select: { timezone: true } });
  return p?.timezone ?? 'America/Sao_Paulo';
}

function todayInTz(tz: string): Date {
  // Returns the UTC midnight of the current calendar date in the given tz.
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
}

export async function upsertTodayCheckin(userId: string, input: CheckinTodayInput) {
  const tz = await userTimezone(userId);
  const date = todayInTz(tz);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.checkIn.findUnique({ where: { userId_date: { userId, date } } });
    if (existing) {
      await tx.event.deleteMany({ where: { checkInId: existing.id } });
    }
    const c = await tx.checkIn.upsert({
      where: { userId_date: { userId, date } },
      create: {
        userId,
        date,
        moodOverall: input.moodOverall,
        intimacyToday: input.intimacyToday,
        dateNightToday: input.dateNightToday,
        events: { create: input.events },
      },
      update: {
        moodOverall: input.moodOverall,
        intimacyToday: input.intimacyToday,
        dateNightToday: input.dateNightToday,
        events: { create: input.events },
      },
      include: { events: true },
    });
    return c;
  });
}

export async function last7Days(userId: string): Promise<{ checkins: { date: string; moodOverall: number | null; intimacyToday: boolean; dateNightToday: boolean }[] }> {
  const tz = await userTimezone(userId);
  const today = todayInTz(tz);
  const days: Date[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d);
  }
  const rows = await prisma.checkIn.findMany({
    where: { userId, date: { in: days } },
    select: { date: true, moodOverall: true, intimacyToday: true, dateNightToday: true },
  });
  const map = new Map(rows.map((r) => [r.date.toISOString().slice(0, 10), r]));
  const checkins = days.map((d) => {
    const key = d.toISOString().slice(0, 10);
    const hit = map.get(key);
    return {
      date: key,
      moodOverall: hit?.moodOverall ?? null,
      intimacyToday: hit?.intimacyToday ?? false,
      dateNightToday: hit?.dateNightToday ?? false,
    };
  });
  return { checkins };
}
```

- [ ] **Step 6: Implement `src/modules/checkins/routes.ts`**

```ts
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { checkinTodayInput } from './schema.js';
import { last7Days, upsertTodayCheckin } from './service.js';

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'checkin route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function checkinsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/checkins/today', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = checkinTodayInput.parse(req.body);
      const c = await upsertTodayCheckin(req.userId!, input);
      return reply.code(201).send(c);
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/checkins/last-7-days', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await last7Days(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
```

- [ ] **Step 7: Register in `src/app.ts`**

Add `import { checkinsRoutes } from './modules/checkins/routes.js';` and `await app.register(checkinsRoutes);`.

- [ ] **Step 8: Migrate and run tests**

Run:
```
npx prisma migrate dev --name add_checkin_and_event
npm test
```
Expected: 4 new tests pass.

- [ ] **Step 9: Commit**

```bash
git add prisma/ src/modules/checkins/ src/app.ts
git commit -m "feat(checkins): daily check-in with events (good/bad, pillar, intensity) + last-7-days"
```

---

### Task 4: Journal privado

**Files:**
- Create: `src/modules/journal/schema.ts`, `src/modules/journal/service.ts`, `src/modules/journal/routes.ts`, `src/modules/journal/journal.test.ts`
- Modify: `prisma/schema.prisma` (add `JournalEntry`), migration, `src/app.ts`

**Interfaces:**
- Consumes: `authenticate`, `prisma`, `AppError`.
- Produces:
  - `JournalEntry` model: `userId`, `title`, `content`, `mood` (1-10 optional), timestamps.
  - `POST /journal` accepts `{ title, content, mood? }` — creates.
  - `GET /journal` returns the user's entries (newest first, paginated with `?limit=&cursor=`).
  - `GET /journal/:id` — 404 if entry doesn't belong to user (never expose partner's).
  - `PATCH /journal/:id` — same ownership rule.
  - `DELETE /journal/:id` — same ownership rule.
- **Invariant:** No endpoint accepts a query for another user; every service function takes `userId` and includes it in the `where` clause.

- [ ] **Step 1: Add `JournalEntry` to `prisma/schema.prisma`**

```prisma
model JournalEntry {
  id        String   @id @default(cuid())
  userId    String
  title     String
  content   String
  mood      Int?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId, createdAt])
}
```

- [ ] **Step 2: Create `src/modules/journal/schema.ts`**

```ts
import { z } from 'zod';

export const createEntryInput = z
  .object({
    title: z.string().min(1).max(120),
    content: z.string().min(1).max(20000),
    mood: z.number().int().min(1).max(10).optional(),
  })
  .strict();
export type CreateEntryInput = z.infer<typeof createEntryInput>;

export const updateEntryInput = createEntryInput.partial().strict();
export type UpdateEntryInput = z.infer<typeof updateEntryInput>;

export const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().optional(),
  })
  .strict();
```

- [ ] **Step 3: Write the failing test**

Create `src/modules/journal/journal.test.ts`:
```ts
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

  it('does NOT expose another user\'s entry (404, not 403)', async () => {
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
    // 404 (not 403) hides the existence of another user's entry entirely
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 4: Run and confirm failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 5: Implement `src/modules/journal/service.ts`**

```ts
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import type { CreateEntryInput, UpdateEntryInput } from './schema.js';

export async function createEntry(userId: string, input: CreateEntryInput) {
  return prisma.journalEntry.create({ data: { userId, ...input } });
}

export async function listEntries(
  userId: string,
  opts: { limit: number; cursor?: string },
): Promise<{ entries: { id: string; title: string; mood: number | null; createdAt: Date }[]; nextCursor: string | null }> {
  const rows = await prisma.journalEntry.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: { id: true, title: true, mood: true, createdAt: true },
  });
  const hasMore = rows.length > opts.limit;
  const entries = hasMore ? rows.slice(0, opts.limit) : rows;
  return { entries, nextCursor: hasMore ? entries[entries.length - 1].id : null };
}

export async function getEntry(userId: string, id: string) {
  const e = await prisma.journalEntry.findFirst({ where: { id, userId } });
  if (!e) throw new AppError('NOT_FOUND', 'Entrada não encontrada', 404);
  return e;
}

export async function updateEntry(userId: string, id: string, input: UpdateEntryInput) {
  // Update-with-ownership: use updateMany + count so we never accidentally
  // update another user's entry, and return the row we own.
  const res = await prisma.journalEntry.updateMany({ where: { id, userId }, data: input });
  if (res.count === 0) throw new AppError('NOT_FOUND', 'Entrada não encontrada', 404);
  return getEntry(userId, id);
}

export async function deleteEntry(userId: string, id: string): Promise<void> {
  const res = await prisma.journalEntry.deleteMany({ where: { id, userId } });
  if (res.count === 0) throw new AppError('NOT_FOUND', 'Entrada não encontrada', 404);
}
```

- [ ] **Step 6: Implement `src/modules/journal/routes.ts`**

```ts
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { createEntryInput, listQuery, updateEntryInput } from './schema.js';
import { createEntry, deleteEntry, getEntry, listEntries, updateEntry } from './service.js';

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'journal route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function journalRoutes(app: FastifyInstance): Promise<void> {
  app.post('/journal', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = createEntryInput.parse(req.body);
      return reply.code(201).send(await createEntry(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/journal', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const q = listQuery.parse(req.query ?? {});
      return reply.code(200).send(await listEntries(req.userId!, q));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get<{ Params: { id: string } }>('/journal/:id', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getEntry(req.userId!, req.params.id));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.patch<{ Params: { id: string } }>('/journal/:id', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = updateEntryInput.parse(req.body);
      return reply.code(200).send(await updateEntry(req.userId!, req.params.id, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.delete<{ Params: { id: string } }>('/journal/:id', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      await deleteEntry(req.userId!, req.params.id);
      return reply.code(204).send();
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
```

- [ ] **Step 7: Register in `src/app.ts`**

Add `import { journalRoutes } from './modules/journal/routes.js';` and `await app.register(journalRoutes);`.

- [ ] **Step 8: Migrate and run tests**

Run:
```
npx prisma migrate dev --name add_journal_entry
npm test
```
Expected: 2 new tests pass.

- [ ] **Step 9: Commit**

```bash
git add prisma/ src/modules/journal/ src/app.ts
git commit -m "feat(journal): private journal CRUD (isolated per user, 404 hides cross-user access)"
```

---

### Task 5: Tarefas do casal

**Files:**
- Create: `src/modules/tasks/schema.ts`, `src/modules/tasks/service.ts`, `src/modules/tasks/routes.ts`, `src/modules/tasks/tasks.test.ts`
- Modify: `prisma/schema.prisma` (add `CoupleTask`), migration, `src/app.ts`

**Interfaces:**
- Consumes: `authenticate`, `prisma`, `AppError`, `PILLARS`.
- Produces:
  - `CoupleTask` model: `coupleId`, `pillar`, `title`, `description?`, `dueBy?`, `createdBy` (userId), `completedByA` (boolean), `completedByB` (boolean), `completedAt?`, timestamps.
  - `POST /tasks` accepts `{ pillar, title, description?, dueBy? }` — requires the user to be in a couple.
  - `GET /tasks` returns the couple's tasks (both users see the same list).
  - `POST /tasks/:id/complete` marks the calling user's completion flag; when BOTH are true, sets `completedAt`.
  - `DELETE /tasks/:id` — either partner may delete.
  - 403 `NO_COUPLE` when the user has no active couple.

- [ ] **Step 1: Add `CoupleTask` to `prisma/schema.prisma`**

```prisma
model CoupleTask {
  id            String    @id @default(cuid())
  coupleId      String
  pillar        String
  title         String
  description   String?
  dueBy         DateTime?
  createdBy     String
  completedByA  Boolean   @default(false)
  completedByB  Boolean   @default(false)
  completedAt   DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([coupleId, createdAt])
}
```

- [ ] **Step 2: Create `src/modules/tasks/schema.ts`**

```ts
import { z } from 'zod';
import { PILLARS } from '../profile/schema.js';

export const createTaskInput = z
  .object({
    pillar: z.enum(PILLARS),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    dueBy: z.string().datetime().optional(),
  })
  .strict();
export type CreateTaskInput = z.infer<typeof createTaskInput>;
```

- [ ] **Step 3: Write the failing test**

Create `src/modules/tasks/tasks.test.ts`:
```ts
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
```

- [ ] **Step 4: Run and confirm failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 5: Implement `src/modules/tasks/service.ts`**

```ts
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import type { CreateTaskInput } from './schema.js';

async function coupleOf(userId: string): Promise<{ id: string; userAId: string; userBId: string }> {
  const c = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true, userAId: true, userBId: true },
  });
  if (!c) throw new AppError('NO_COUPLE', 'Você ainda não está vinculado a um casal', 403);
  return c;
}

export async function createTask(userId: string, input: CreateTaskInput) {
  const couple = await coupleOf(userId);
  return prisma.coupleTask.create({
    data: {
      coupleId: couple.id,
      pillar: input.pillar,
      title: input.title,
      description: input.description,
      dueBy: input.dueBy ? new Date(input.dueBy) : null,
      createdBy: userId,
    },
  });
}

export async function listTasks(userId: string) {
  const couple = await coupleOf(userId);
  const tasks = await prisma.coupleTask.findMany({
    where: { coupleId: couple.id },
    orderBy: { createdAt: 'desc' },
  });
  return { tasks };
}

export async function completeTask(userId: string, id: string) {
  const couple = await coupleOf(userId);
  const task = await prisma.coupleTask.findFirst({ where: { id, coupleId: couple.id } });
  if (!task) throw new AppError('NOT_FOUND', 'Tarefa não encontrada', 404);
  const patch = userId === couple.userAId ? { completedByA: true } : { completedByB: true };
  const updated = await prisma.coupleTask.update({
    where: { id },
    data: patch,
  });
  if (updated.completedByA && updated.completedByB && !updated.completedAt) {
    return prisma.coupleTask.update({ where: { id }, data: { completedAt: new Date() } });
  }
  return updated;
}

export async function deleteTask(userId: string, id: string): Promise<void> {
  const couple = await coupleOf(userId);
  const res = await prisma.coupleTask.deleteMany({ where: { id, coupleId: couple.id } });
  if (res.count === 0) throw new AppError('NOT_FOUND', 'Tarefa não encontrada', 404);
}
```

- [ ] **Step 6: Implement `src/modules/tasks/routes.ts`**

```ts
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { createTaskInput } from './schema.js';
import { completeTask, createTask, deleteTask, listTasks } from './service.js';

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'tasks route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function tasksRoutes(app: FastifyInstance): Promise<void> {
  app.post('/tasks', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = createTaskInput.parse(req.body);
      return reply.code(201).send(await createTask(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/tasks', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await listTasks(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/complete', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await completeTask(req.userId!, req.params.id));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.delete<{ Params: { id: string } }>('/tasks/:id', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      await deleteTask(req.userId!, req.params.id);
      return reply.code(204).send();
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
```

- [ ] **Step 7: Register in `src/app.ts`**

Add `import { tasksRoutes } from './modules/tasks/routes.js';` and `await app.register(tasksRoutes);`.

- [ ] **Step 8: Migrate and run tests**

Run:
```
npx prisma migrate dev --name add_couple_task
npm test
```
Expected: 3 new tests pass.

- [ ] **Step 9: Commit**

```bash
git add prisma/ src/modules/tasks/ src/app.ts
git commit -m "feat(tasks): couple tasks (both partners see; completedAt only after both mark done)"
```

---

### Task 6: Health index básico

**Files:**
- Create: `src/modules/health-index/service.ts`, `src/modules/health-index/routes.ts`, `src/modules/health-index/health-index.test.ts`

**Interfaces:**
- Consumes: `authenticate`, `prisma`, `AppError`, couple lookup.
- Produces:
  - `GET /couples/me/health` returns `{ overall: number, byPillar: Record<pillar, number>, weekly: { badEventsCount: number, goodEventsCount: number, intimacyDays: number, dateNights: number, tasksCompleted: number, tasksPending: number } }`
  - `overall` is a 0-100 index computed from last 7 days:
    - **Base 60**
    - **+3** per good event (cap +25)
    - **-3** per bad event (cap -30)
    - **+2** per intimacy day
    - **+2** per date night
    - **+3** per completed task
    - **-2** per pending task older than 7 days
    - Clamped to [0, 100]
  - `byPillar` uses the same formula but restricted to events/tasks of that pillar; missing signal = 60 neutral.
  - 403 `NO_COUPLE` if the user has no couple.

- [ ] **Step 1: Write the failing test**

Create `src/modules/health-index/health-index.test.ts`:
```ts
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
    // 2 bad events (-6) + 1 good (+3) + intimacy (+2)
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
    // 1 completed task (+3) — both partners must mark
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
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implement `src/modules/health-index/service.ts`**

```ts
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { PILLARS } from '../profile/schema.js';

const BASE = 60;

interface Weekly {
  badEventsCount: number;
  goodEventsCount: number;
  intimacyDays: number;
  dateNights: number;
  tasksCompleted: number;
  tasksPending: number;
}

export async function computeHealth(userId: string): Promise<{
  overall: number;
  byPillar: Record<string, number>;
  weekly: Weekly;
}> {
  const couple = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true, userAId: true, userBId: true },
  });
  if (!couple) throw new AppError('NO_COUPLE', 'Você ainda não está vinculado a um casal', 403);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const bothUserIds = [couple.userAId, couple.userBId];

  const checkins = await prisma.checkIn.findMany({
    where: { userId: { in: bothUserIds }, date: { gte: sevenDaysAgo } },
    include: { events: true },
  });
  const tasks = await prisma.coupleTask.findMany({
    where: { coupleId: couple.id },
  });

  const events = checkins.flatMap((c) => c.events);
  const goodEvents = events.filter((e) => e.kind === 'good');
  const badEvents = events.filter((e) => e.kind === 'bad');
  const intimacyDays = checkins.filter((c) => c.intimacyToday).length;
  const dateNights = checkins.filter((c) => c.dateNightToday).length;
  const completedTasks = tasks.filter((t) => t.completedAt && t.completedAt >= sevenDaysAgo);
  const pendingOld = tasks.filter(
    (t) => !t.completedAt && t.createdAt < sevenDaysAgo,
  );

  function score(good: number, bad: number, intimacy: number, dates: number, done: number, pending: number): number {
    const s =
      BASE
      + Math.min(good * 3, 25)
      - Math.min(bad * 3, 30)
      + intimacy * 2
      + dates * 2
      + done * 3
      - pending * 2;
    return Math.max(0, Math.min(100, s));
  }

  const overall = score(
    goodEvents.length,
    badEvents.length,
    intimacyDays,
    dateNights,
    completedTasks.length,
    pendingOld.length,
  );

  const byPillar: Record<string, number> = {};
  for (const p of PILLARS) {
    const g = goodEvents.filter((e) => e.pillar === p).length;
    const b = badEvents.filter((e) => e.pillar === p).length;
    const done = completedTasks.filter((t) => t.pillar === p).length;
    const pend = pendingOld.filter((t) => t.pillar === p).length;
    // For per-pillar, intimacy/dateNights don't apply (they'd count twice)
    byPillar[p] = score(g, b, 0, 0, done, pend);
  }

  const weekly: Weekly = {
    badEventsCount: badEvents.length,
    goodEventsCount: goodEvents.length,
    intimacyDays,
    dateNights,
    tasksCompleted: completedTasks.length,
    tasksPending: pendingOld.length,
  };

  return { overall, byPillar, weekly };
}
```

- [ ] **Step 4: Implement `src/modules/health-index/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors.js';
import { computeHealth } from './service.js';

export async function healthIndexRoutes(app: FastifyInstance): Promise<void> {
  app.get('/couples/me/health', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await computeHealth(req.userId!));
    } catch (err) {
      if (err instanceof AppError) {
        return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      }
      req.log.error({ err }, 'health index failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });
}
```

- [ ] **Step 5: Register in `src/app.ts`**

Add `import { healthIndexRoutes } from './modules/health-index/routes.js';` and `await app.register(healthIndexRoutes);`.

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: 3 new tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/modules/health-index/ src/app.ts
git commit -m "feat(health): couple health index (baseline 60 + weekly signal from events/intimacy/tasks)"
```

---

## Self-Review Notes

- **Spec coverage:** covers spec §2.1 (Profile onboarding data + safety screening — Tasks 1+2); §2.2 (Check-in — Task 3); §2.5 (Journal — Task 4); §2.7 (Tasks — Task 5); §2.9 (Health index — Task 6). Spec §2.3 (Modo conflito full flow), §2.4 (Ponte por blocos), §2.6 (Sessão semanal), §2.8 (Rituais), §2.13 (Modo separação) are Plan 4 material.
- **Placeholder scan:** none.
- **Type consistency:** `PILLARS` defined once in `profile/schema.ts` and imported by `checkins/schema.ts` and `tasks/schema.ts`. `AppError`, `authenticate` decorator, `prisma` singleton unchanged. `careModeActive(userId)` from Task 2 is the hook Plan 4 will call before opening the ponte.
- **Data segregation:** every `Journal` and `CheckIn` service function includes `userId` in the WHERE. `Task` and `Health` operate at the couple level (both users see) — never expose one user's raw check-ins/journal to their partner, only the aggregate index.
