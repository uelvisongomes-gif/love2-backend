# LOVE Casal Ponte por Blocos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the conflict mediation flow where partner A talks to LOVE about a fight, LOVE generates a summary in **blocks**, A approves/edits/removes each block, and only the approved blocks reach partner B — who then gives their own version to LOVE. Finally, LOVE cross-references both sides and returns per-side insights (never sharing raw content across). This is the app's most sensitive flow: cross-side data isolation, care-mode routing, and non-accusatory framing are non-negotiable.

**Architecture:** New module `src/modules/conflicts/` (routes + service + schema + tests). New Prisma models `Conflict`, `ConflictMessage`, `ConflictBlock`, `ConflictInvitation`. The AI Orchestrator built in Plan 2 is reused with two new prompt shapes: (a) block-generation prompt (turn A's messages into 3–6 blocks) and (b) B-approach prompt (consultive introduction using authorized blocks). Every cross-side read (B's endpoint reading conflict data) filters aggressively: B sees only B's own messages + the **approved** blocks. Care-mode routing sits above the whole flow: if either partner has `careModeActive` from Plan 3, ponte cannot open — the endpoint returns guidance to seek professional help instead.

**Tech Stack:** Same as Foundation + AI Core + Plan 3. No new third-party dependencies.

**Spec:** `docs/superpowers/specs/2026-09-05-love-casal-design.md` (§2.3 modo conflito, §2.4 ponte por blocos)

## Global Constraints

- **All prior Global Constraints apply** (TypeScript strict, LOVE identity, safety-first, vendor-neutral, LGPD).
- **Cross-side data isolation (invariant):**
  - `ConflictMessage` rows are per-side. A's messages are readable only by A; B's messages are readable only by B. **Neither side ever reads the other's raw messages** — not even through admin endpoints in this plan.
  - The only cross-side channel is `ConflictBlock` rows with `status = 'approved'` (or `'edited'`). Every read of "the other side's content" goes through the approved-blocks filter.
  - Enforcement: service functions accepting a `userId` MUST verify (a) the user belongs to the conflict's couple AND (b) the requested resource matches their side. Cross-side queries return 404, not 403.
- **Care-mode gate (invariant):** Before opening a ponte, the service calls `careModeActive` (from Plan 3's `safety-screening`) for BOTH partners. If either is true, the ponte MUST NOT open — the endpoint returns 403 `CARE_MODE_ACTIVE` with a message directing to professional help (CVV 188 / Ligue 180 / etc.). The A-side conversation with LOVE still works (individual support), but the ponte itself is blocked.
- **LOVE tone when approaching B:** consultive, never accusatory. Prompts in this plan hard-code: *"seu(sua) parceiro(a) conversou comigo sobre algo que aconteceu — não trago acusação, quero ouvir a sua perspectiva."*
- **Block generation constraints:** blocks must be **factual and de-inflammatory**. LOVE is instructed to convert accusations into observations/feelings/needs (CNV). "Ela sempre gasta demais" → "sinto insegurança financeira quando não sabemos quanto sobrou no mês".
- **No auto-share:** approved blocks do NOT automatically fire the ponte. A explicit `POST /conflicts/:id/ponte/open` is required, which itself runs the care-mode gate.
- **Cross-reference insights:** the analysis after both sides talk returns **per-user insights** — A sees the A-insight, B sees the B-insight. Neither sees the other's insight. No "the other person said X" leaks.
- **Consent gate:** the disclaimer consent from Plan 2 (`disclaimer_love_not_therapist`) applies to every LOVE-touching endpoint in this plan.

---

### Task 1: Conflict data model + A opens a conflict + A talks to LOVE

**Files:**
- Create: `src/modules/conflicts/schema.ts`, `src/modules/conflicts/service.ts`, `src/modules/conflicts/routes.ts`, `src/modules/conflicts/conflict-create.test.ts`
- Modify: `prisma/schema.prisma` (add `Conflict`, `ConflictMessage`), migration, `src/app.ts` (register)

**Interfaces:**
- Consumes: `authenticate`, `prisma`, `AppError`, `chatWithLove` from Plan 2's orchestrator, `PILLARS`, `CURRENT_CONSENT_VERSIONS` (consent gate).
- Produces:
  - `Conflict` model: id, coupleId, initiatorId (A), targetId (B), status ('collecting_a' | 'blocks_pending' | 'ponte_invited' | 'ponte_accepted' | 'ponte_declined' | 'collecting_b' | 'cross_referenced' | 'closed'), pillar (optional), title (optional short label), createdAt, updatedAt.
  - `ConflictMessage` model: id, conflictId, side ('A' | 'B'), authorId, role ('user' | 'assistant'), content, createdAt.
  - `POST /conflicts` (auth, requires couple + disclaimer consent) accepts `{ initialContent, pillar? }` — creates conflict with initiator=A, status='collecting_a', persists A's initial message + LOVE's response (via existing `chatWithLove` with `context: 'conflict'`).
  - `POST /conflicts/:id/messages` (auth) accepts `{ content }` — appends A's message, LOVE responds. Only A can post here while status is `collecting_a` (or `cross_referenced`); only B while `collecting_b`; else 403 `WRONG_SIDE`.
  - `GET /conflicts/:id` returns conflict metadata + messages **on the user's side only**.
  - `GET /conflicts` lists conflicts where the user is initiator or target (returns metadata only, no message content).

- [ ] **Step 1: Add `Conflict` and `ConflictMessage` to `prisma/schema.prisma`**

```prisma
model Conflict {
  id          String   @id @default(cuid())
  coupleId    String
  initiatorId String
  targetId    String
  status      String   // see enum in schema.ts
  pillar      String?
  title       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([coupleId, createdAt])
  @@index([initiatorId])
  @@index([targetId])
}

model ConflictMessage {
  id         String   @id @default(cuid())
  conflictId String
  side       String   // 'A' | 'B'
  authorId   String
  role       String   // 'user' | 'assistant'
  content    String
  createdAt  DateTime @default(now())

  @@index([conflictId, createdAt])
}
```

- [ ] **Step 2: Create `src/modules/conflicts/schema.ts`**

```ts
import { z } from 'zod';
import { PILLARS } from '../profile/schema.js';

export const CONFLICT_STATUS = [
  'collecting_a',
  'blocks_pending',
  'ponte_invited',
  'ponte_accepted',
  'ponte_declined',
  'collecting_b',
  'cross_referenced',
  'closed',
] as const;
export type ConflictStatus = (typeof CONFLICT_STATUS)[number];

export const createConflictInput = z
  .object({
    initialContent: z.string().min(1).max(4000),
    pillar: z.enum(PILLARS).optional(),
    title: z.string().max(120).optional(),
  })
  .strict();
export type CreateConflictInput = z.infer<typeof createConflictInput>;

export const conflictMessageInput = z
  .object({ content: z.string().min(1).max(4000) })
  .strict();
export type ConflictMessageInput = z.infer<typeof conflictMessageInput>;
```

- [ ] **Step 3: Write the failing tests**

Create `src/modules/conflicts/conflict-create.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';
import { MemoryLlmProvider, setLlmProvider } from '../../ai/llm.js';

const llm = new MemoryLlmProvider();
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
async function grantDisclaimer(token: string) {
  await app.inject({
    method: 'POST',
    url: '/consent',
    headers: { authorization: `Bearer ${token}` },
    payload: { scope: 'disclaimer_love_not_therapist', version: '1' },
  });
}
async function pairCouple() {
  const aTok = await makeAuthedUser('a@x.com', '+5511900000070');
  const bTok = await makeAuthedUser('b@x.com', '+5511900000071');
  await grantDisclaimer(aTok);
  await grantDisclaimer(bTok);
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
  setLlmProvider(llm);
  llm.calls.length = 0;
  await prisma.conflictMessage.deleteMany();
  await prisma.conflict.deleteMany();
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

describe('Conflict — create + A talks', () => {
  it('A creates a conflict and LOVE responds; both messages persisted on A side', async () => {
    const { aTok } = await pairCouple();
    llm.enqueue('Entendo, vamos por partes.');
    const res = await app.inject({
      method: 'POST',
      url: '/conflicts',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { initialContent: 'Brigamos por dinheiro de novo.', pillar: 'financeiro' },
    });
    expect(res.statusCode).toBe(201);
    const conflictId = res.json().id;

    const msgs = await prisma.conflictMessage.findMany({ where: { conflictId }, orderBy: { createdAt: 'asc' } });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ side: 'A', role: 'user' });
    expect(msgs[1]).toMatchObject({ side: 'A', role: 'assistant', content: 'Entendo, vamos por partes.' });
  });

  it('creating a conflict without a couple returns 403 NO_COUPLE', async () => {
    const tok = await makeAuthedUser('solo@x.com', '+5511900000072');
    await grantDisclaimer(tok);
    const res = await app.inject({
      method: 'POST',
      url: '/conflicts',
      headers: { authorization: `Bearer ${tok}` },
      payload: { initialContent: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NO_COUPLE');
  });

  it('B cannot post messages while status is collecting_a (WRONG_SIDE)', async () => {
    const { aTok, bTok } = await pairCouple();
    llm.enqueue('resposta 1');
    const create = await app.inject({
      method: 'POST',
      url: '/conflicts',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { initialContent: 'x' },
    });
    const id = create.json().id;

    const res = await app.inject({
      method: 'POST',
      url: `/conflicts/${id}/messages`,
      headers: { authorization: `Bearer ${bTok}` },
      payload: { content: 'quero falar' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('WRONG_SIDE');
  });

  it('A gets only A-side messages via GET /conflicts/:id', async () => {
    const { aTok } = await pairCouple();
    llm.enqueue('r1');
    llm.enqueue('r2');
    const create = await app.inject({
      method: 'POST',
      url: '/conflicts',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { initialContent: 'primeira' },
    });
    const id = create.json().id;
    await app.inject({
      method: 'POST',
      url: `/conflicts/${id}/messages`,
      headers: { authorization: `Bearer ${aTok}` },
      payload: { content: 'segunda' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/conflicts/${id}`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().messages).toHaveLength(4); // 2 user + 2 assistant
    for (const m of res.json().messages) expect(m.side).toBe('A');
  });
});
```

- [ ] **Step 4: Run and confirm failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 5: Implement `src/modules/conflicts/service.ts`**

```ts
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { chatWithLove } from '../../ai/orchestrator.js';
import { CURRENT_CONSENT_VERSIONS } from '../consent/service.js';
import type { ConflictStatus } from './schema.js';
import type { CreateConflictInput, ConflictMessageInput } from './schema.js';

async function assertLoveConsent(userId: string): Promise<void> {
  const required = CURRENT_CONSENT_VERSIONS.disclaimer_love_not_therapist;
  const hit = await prisma.consent.findFirst({
    where: { userId, scope: 'disclaimer_love_not_therapist', version: required },
  });
  if (!hit) throw new AppError('CONSENT_REQUIRED', 'Aceite o disclaimer da LOVE para usar', 403);
}

async function coupleOf(userId: string) {
  const c = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true, userAId: true, userBId: true },
  });
  if (!c) throw new AppError('NO_COUPLE', 'Você ainda não está vinculado a um casal', 403);
  return c;
}

function sideOf(userId: string, initiatorId: string): 'A' | 'B' {
  return userId === initiatorId ? 'A' : 'B';
}

function canPost(status: ConflictStatus, side: 'A' | 'B'): boolean {
  if (side === 'A') return status === 'collecting_a' || status === 'cross_referenced';
  return status === 'collecting_b';
}

export async function createConflict(userId: string, input: CreateConflictInput) {
  await assertLoveConsent(userId);
  const couple = await coupleOf(userId);
  const targetId = couple.userAId === userId ? couple.userBId : couple.userAId;
  return prisma.$transaction(async (tx) => {
    const conflict = await tx.conflict.create({
      data: {
        coupleId: couple.id,
        initiatorId: userId,
        targetId,
        status: 'collecting_a',
        pillar: input.pillar,
        title: input.title,
      },
    });
    await tx.conflictMessage.create({
      data: { conflictId: conflict.id, side: 'A', authorId: userId, role: 'user', content: input.initialContent },
    });
    const reply = await chatWithLove({
      userId,
      content: input.initialContent,
      context: 'conflict',
    });
    await tx.conflictMessage.create({
      data: { conflictId: conflict.id, side: 'A', authorId: userId, role: 'assistant', content: reply.reply },
    });
    return conflict;
  });
}

export async function postMessage(userId: string, conflictId: string, input: ConflictMessageInput) {
  await assertLoveConsent(userId);
  const conflict = await prisma.conflict.findUnique({ where: { id: conflictId } });
  if (!conflict) throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  await coupleOf(userId); // validates couple membership
  if (conflict.initiatorId !== userId && conflict.targetId !== userId) {
    throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  }
  const side = sideOf(userId, conflict.initiatorId);
  if (!canPost(conflict.status as ConflictStatus, side)) {
    throw new AppError('WRONG_SIDE', 'Não é sua vez nesta etapa do conflito', 403);
  }
  return prisma.$transaction(async (tx) => {
    await tx.conflictMessage.create({
      data: { conflictId, side, authorId: userId, role: 'user', content: input.content },
    });
    const reply = await chatWithLove({ userId, content: input.content, context: 'conflict' });
    const asst = await tx.conflictMessage.create({
      data: { conflictId, side, authorId: userId, role: 'assistant', content: reply.reply },
    });
    return asst;
  });
}

export async function getConflict(userId: string, conflictId: string) {
  const conflict = await prisma.conflict.findUnique({ where: { id: conflictId } });
  if (!conflict) throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  if (conflict.initiatorId !== userId && conflict.targetId !== userId) {
    throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  }
  const side = sideOf(userId, conflict.initiatorId);
  const messages = await prisma.conflictMessage.findMany({
    where: { conflictId, side },
    orderBy: { createdAt: 'asc' },
    select: { id: true, side: true, role: true, content: true, createdAt: true },
  });
  return {
    id: conflict.id,
    status: conflict.status,
    pillar: conflict.pillar,
    title: conflict.title,
    createdAt: conflict.createdAt,
    updatedAt: conflict.updatedAt,
    mySide: side,
    messages,
  };
}

export async function listConflicts(userId: string) {
  const conflicts = await prisma.conflict.findMany({
    where: { OR: [{ initiatorId: userId }, { targetId: userId }] },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      pillar: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      initiatorId: true,
    },
  });
  return {
    conflicts: conflicts.map((c) => ({
      id: c.id,
      status: c.status,
      pillar: c.pillar,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      role: c.initiatorId === userId ? 'A' : 'B',
    })),
  };
}
```

- [ ] **Step 6: Implement `src/modules/conflicts/routes.ts`**

```ts
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { conflictMessageInput, createConflictInput } from './schema.js';
import { createConflict, getConflict, listConflicts, postMessage } from './service.js';

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'conflict route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

export async function conflictsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/conflicts', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = createConflictInput.parse(req.body);
      return reply.code(201).send(await createConflict(req.userId!, input));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.post<{ Params: { id: string } }>(
    '/conflicts/:id/messages',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const input = conflictMessageInput.parse(req.body);
        return reply.code(201).send(await postMessage(req.userId!, req.params.id, input));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.get<{ Params: { id: string } }>('/conflicts/:id', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getConflict(req.userId!, req.params.id));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/conflicts', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await listConflicts(req.userId!));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
```

- [ ] **Step 7: Register in `src/app.ts`**

Add `import { conflictsRoutes } from './modules/conflicts/routes.js';` + `await app.register(conflictsRoutes);`.

- [ ] **Step 8: Manual migration + tests**

Since `prisma migrate dev` is non-interactive and Source's vector column trips drift detection, use the manual pattern established in Plan 3:

Create `prisma/migrations/<timestamp>_add_conflict/migration.sql`:
```sql
CREATE TABLE "Conflict" (
    "id" TEXT NOT NULL,
    "coupleId" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "pillar" TEXT,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conflict_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Conflict_coupleId_createdAt_idx" ON "Conflict"("coupleId", "createdAt");
CREATE INDEX "Conflict_initiatorId_idx" ON "Conflict"("initiatorId");
CREATE INDEX "Conflict_targetId_idx" ON "Conflict"("targetId");

CREATE TABLE "ConflictMessage" (
    "id" TEXT NOT NULL,
    "conflictId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConflictMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConflictMessage_conflictId_createdAt_idx" ON "ConflictMessage"("conflictId", "createdAt");
```

Run:
```
npx prisma migrate deploy
npx prisma generate
npm test
```
Expected: 4 new tests pass.

- [ ] **Step 9: Commit**

```bash
git add prisma/ src/modules/conflicts/ src/app.ts
git commit -m "feat(conflicts): Conflict + ConflictMessage models, A opens conflict + talks to LOVE"
```

---

### Task 2: LOVE-generated blocks + A approves/edits/removes

**Files:**
- Create: `src/modules/conflicts/blocks.ts`, `src/modules/conflicts/blocks.test.ts`
- Modify: `prisma/schema.prisma` (add `ConflictBlock`), migration, `src/modules/conflicts/routes.ts` (add block endpoints)

**Interfaces:**
- Consumes: `getLlmProvider`, existing conflict + auth infrastructure.
- Produces:
  - `ConflictBlock` model: id, conflictId, `order` (int), content (text), status ('proposed' | 'approved' | 'edited' | 'removed'), createdAt, updatedAt.
  - `POST /conflicts/:id/blocks/generate` (auth, initiator only) — calls LOVE with A's conversation so far, gets back 3–6 blocks (JSON array of strings), persists them with status='proposed', transitions conflict to 'blocks_pending'.
  - `GET /conflicts/:id/blocks` (auth, initiator only for now — B gets a separate endpoint later that returns only approved blocks) — returns all blocks with statuses.
  - `PATCH /conflicts/:id/blocks/:blockId` (auth, initiator only) accepts `{ status: 'approved' | 'removed' } | { status: 'edited', content: string }`.
  - Block generation prompt is CNV-driven: converts accusations to observations/feelings/needs.

- [ ] **Step 1: Add `ConflictBlock` to `prisma/schema.prisma`**

```prisma
model ConflictBlock {
  id         String   @id @default(cuid())
  conflictId String
  order      Int
  content    String
  status     String   // 'proposed' | 'approved' | 'edited' | 'removed'
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([conflictId, order])
}
```

- [ ] **Step 2: Create `src/modules/conflicts/blocks.ts`**

```ts
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { getLlmProvider, type LlmMessage } from '../../ai/llm.js';

const BLOCK_GEN_SYSTEM = [
  'Você é LOVE, mediadora do LOVE Casal. Você NÃO é psicóloga nem terapeuta.',
  '',
  'Sua tarefa agora: leia a conversa abaixo entre você e a pessoa A, e produza',
  'entre 3 e 6 blocos de resumo que poderão ser mostrados ao parceiro B, SE A autorizar.',
  '',
  'Regras absolutas para cada bloco:',
  '1. Fatual: descreva o que aconteceu, quando, onde — sem interpretar motivação.',
  '2. Em Comunicação Não-Violenta: converta acusações em observação + sentimento + necessidade.',
  '   Ex: "ele é controlador" -> "senti que preciso de mais autonomia sobre pequenas decisões".',
  '3. Fala em primeira pessoa (do ponto de vista de A).',
  '4. NUNCA use adjetivos que definem o outro ("controlador", "egoísta", "irresponsável").',
  '5. Cada bloco tem 1 a 3 frases, no máximo.',
  '',
  'Responda APENAS com um array JSON de strings, sem texto antes ou depois.',
  'Exemplo: ["bloco 1", "bloco 2", "bloco 3"]',
].join('\n');

export interface BlockRow {
  id: string;
  order: number;
  content: string;
  status: 'proposed' | 'approved' | 'edited' | 'removed';
  createdAt: Date;
  updatedAt: Date;
}

export const updateBlockInput = z
  .discriminatedUnion('status', [
    z.object({ status: z.literal('approved') }).strict(),
    z.object({ status: z.literal('removed') }).strict(),
    z.object({ status: z.literal('edited'), content: z.string().min(1).max(1000) }).strict(),
  ]);
export type UpdateBlockInput = z.infer<typeof updateBlockInput>;

async function assertInitiator(userId: string, conflictId: string): Promise<{ id: string }> {
  const c = await prisma.conflict.findUnique({ where: { id: conflictId } });
  if (!c) throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  if (c.initiatorId !== userId) throw new AppError('NOT_INITIATOR', 'Apenas quem abriu o conflito pode fazer isso', 403);
  return { id: c.id };
}

function tryParseBlocks(text: string): string[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('LLM did not return a JSON array');
  const parsed: unknown = JSON.parse(match[0]);
  if (!Array.isArray(parsed) || !parsed.every((s) => typeof s === 'string')) {
    throw new Error('LLM did not return an array of strings');
  }
  return parsed;
}

export async function generateBlocks(userId: string, conflictId: string): Promise<{ blocks: BlockRow[] }> {
  await assertInitiator(userId, conflictId);

  const history = await prisma.conflictMessage.findMany({
    where: { conflictId, side: 'A' },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  });
  if (history.length === 0) {
    throw new AppError('NO_HISTORY', 'Converse primeiro com a LOVE antes de gerar blocos', 400);
  }

  const messages: LlmMessage[] = history.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));
  const llm = await getLlmProvider().complete(messages, { system: BLOCK_GEN_SYSTEM, maxTokens: 1500 });

  let contents: string[];
  try {
    contents = tryParseBlocks(llm.text);
  } catch (e) {
    throw new AppError('BLOCK_GEN_FAILED', `Não consegui gerar os blocos agora: ${(e as Error).message}`, 500);
  }
  if (contents.length < 3 || contents.length > 6) {
    throw new AppError('BLOCK_GEN_INVALID_COUNT', `LOVE retornou ${contents.length} blocos (esperado 3–6)`, 500);
  }

  return prisma.$transaction(async (tx) => {
    // Replace any existing proposed blocks
    await tx.conflictBlock.deleteMany({ where: { conflictId, status: 'proposed' } });
    const created: BlockRow[] = [];
    for (let i = 0; i < contents.length; i++) {
      const row = await tx.conflictBlock.create({
        data: { conflictId, order: i, content: contents[i], status: 'proposed' },
      });
      created.push(row as BlockRow);
    }
    await tx.conflict.update({ where: { id: conflictId }, data: { status: 'blocks_pending' } });
    return { blocks: created };
  });
}

export async function listBlocks(userId: string, conflictId: string): Promise<{ blocks: BlockRow[] }> {
  await assertInitiator(userId, conflictId);
  const blocks = (await prisma.conflictBlock.findMany({
    where: { conflictId },
    orderBy: { order: 'asc' },
  })) as BlockRow[];
  return { blocks };
}

export async function updateBlock(
  userId: string,
  conflictId: string,
  blockId: string,
  input: UpdateBlockInput,
): Promise<BlockRow> {
  await assertInitiator(userId, conflictId);
  const block = await prisma.conflictBlock.findFirst({ where: { id: blockId, conflictId } });
  if (!block) throw new AppError('NOT_FOUND', 'Bloco não encontrado', 404);
  const data: { status: string; content?: string } = { status: input.status };
  if (input.status === 'edited') data.content = input.content;
  const updated = (await prisma.conflictBlock.update({ where: { id: blockId }, data })) as BlockRow;
  return updated;
}

/** Read-only helper for downstream tasks (ponte activation): returns approved/edited blocks in order. */
export async function authorizedBlocks(conflictId: string): Promise<BlockRow[]> {
  return (await prisma.conflictBlock.findMany({
    where: { conflictId, status: { in: ['approved', 'edited'] } },
    orderBy: { order: 'asc' },
  })) as BlockRow[];
}
```

- [ ] **Step 3: Write the failing tests**

Create `src/modules/conflicts/blocks.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';
import { MemoryLlmProvider, setLlmProvider } from '../../ai/llm.js';

const llm = new MemoryLlmProvider();
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
async function grantDisclaimer(token: string) {
  await app.inject({
    method: 'POST',
    url: '/consent',
    headers: { authorization: `Bearer ${token}` },
    payload: { scope: 'disclaimer_love_not_therapist', version: '1' },
  });
}
async function pairAndOpenConflict(): Promise<{ aTok: string; bTok: string; conflictId: string }> {
  const aTok = await makeAuthedUser('a@x.com', '+5511900000080');
  const bTok = await makeAuthedUser('b@x.com', '+5511900000081');
  await grantDisclaimer(aTok);
  await grantDisclaimer(bTok);
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
  llm.enqueue('r1');
  const c = await app.inject({
    method: 'POST',
    url: '/conflicts',
    headers: { authorization: `Bearer ${aTok}` },
    payload: { initialContent: 'Brigamos por dinheiro. Ele acha que gasto demais.' },
  });
  return { aTok, bTok, conflictId: c.json().id };
}

beforeEach(async () => {
  setLlmProvider(llm);
  llm.calls.length = 0;
  await prisma.conflictBlock.deleteMany();
  await prisma.conflictMessage.deleteMany();
  await prisma.conflict.deleteMany();
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

const validBlocksJson = JSON.stringify([
  'Nos últimos meses, tivemos discussões repetidas ao rever as contas do mês.',
  'Sinto insegurança quando não sei quanto sobra até o fim do mês.',
  'Preciso de mais previsibilidade financeira e conversas fora do calor do momento.',
]);

describe('Conflict blocks', () => {
  it('generates 3-6 blocks and stores them as proposed', async () => {
    const { aTok, conflictId } = await pairAndOpenConflict();
    llm.enqueue(validBlocksJson);
    const res = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/blocks/generate`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(res.statusCode).toBe(201);
    const blocks = res.json().blocks;
    expect(blocks).toHaveLength(3);
    expect(blocks[0].status).toBe('proposed');
    expect(blocks[0].order).toBe(0);

    const conflict = await prisma.conflict.findUnique({ where: { id: conflictId } });
    expect(conflict!.status).toBe('blocks_pending');
  });

  it('approves and removes blocks', async () => {
    const { aTok, conflictId } = await pairAndOpenConflict();
    llm.enqueue(validBlocksJson);
    const gen = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/blocks/generate`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    const blocks = gen.json().blocks;

    const approve = await app.inject({
      method: 'PATCH',
      url: `/conflicts/${conflictId}/blocks/${blocks[0].id}`,
      headers: { authorization: `Bearer ${aTok}` },
      payload: { status: 'approved' },
    });
    expect(approve.json().status).toBe('approved');

    const remove = await app.inject({
      method: 'PATCH',
      url: `/conflicts/${conflictId}/blocks/${blocks[1].id}`,
      headers: { authorization: `Bearer ${aTok}` },
      payload: { status: 'removed' },
    });
    expect(remove.json().status).toBe('removed');

    const edit = await app.inject({
      method: 'PATCH',
      url: `/conflicts/${conflictId}/blocks/${blocks[2].id}`,
      headers: { authorization: `Bearer ${aTok}` },
      payload: { status: 'edited', content: 'versão minha' },
    });
    expect(edit.json().status).toBe('edited');
    expect(edit.json().content).toBe('versão minha');
  });

  it('rejects B trying to view or edit blocks (NOT_INITIATOR)', async () => {
    const { aTok, bTok, conflictId } = await pairAndOpenConflict();
    llm.enqueue(validBlocksJson);
    await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/blocks/generate`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/conflicts/${conflictId}/blocks`,
      headers: { authorization: `Bearer ${bTok}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_INITIATOR');
  });

  it('rejects generation when LOVE returns garbage', async () => {
    const { aTok, conflictId } = await pairAndOpenConflict();
    llm.enqueue('desculpa, não consegui gerar');
    const res = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/blocks/generate`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('BLOCK_GEN_FAILED');
  });
});
```

- [ ] **Step 4: Add block routes in `src/modules/conflicts/routes.ts`**

Add imports:
```ts
import { generateBlocks, listBlocks, updateBlock, updateBlockInput } from './blocks.js';
```

Inside `conflictsRoutes` (after the message endpoint):
```ts
  app.post<{ Params: { id: string } }>(
    '/conflicts/:id/blocks/generate',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(201).send(await generateBlocks(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/conflicts/:id/blocks',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(200).send(await listBlocks(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.patch<{ Params: { id: string; blockId: string } }>(
    '/conflicts/:id/blocks/:blockId',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const input = updateBlockInput.parse(req.body);
        return reply.code(200).send(await updateBlock(req.userId!, req.params.id, req.params.blockId, input));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );
```

- [ ] **Step 5: Migrate and run tests**

Create `prisma/migrations/<timestamp>_add_conflict_block/migration.sql`:
```sql
CREATE TABLE "ConflictBlock" (
    "id" TEXT NOT NULL,
    "conflictId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConflictBlock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConflictBlock_conflictId_order_idx" ON "ConflictBlock"("conflictId", "order");
```

Run: `npx prisma migrate deploy && npx prisma generate && npm test`
Expected: 4 new tests pass.

- [ ] **Step 6: Commit**

```bash
git add prisma/ src/modules/conflicts/
git commit -m "feat(conflicts): block generation (CNV-converted) + A approves/edits/removes"
```

---

### Task 3: Ponte activation + care-mode gate + B accepts/declines

**Files:**
- Create: `src/modules/conflicts/ponte.ts`, `src/modules/conflicts/ponte.test.ts`
- Modify: `src/modules/conflicts/routes.ts` (add ponte endpoints)

**Interfaces:**
- Consumes: `authorizedBlocks` from `blocks.ts`, `careModeActive` from Plan 3's `safety-screening.ts`, `getLlmProvider`.
- Produces:
  - `POST /conflicts/:id/ponte/open` (auth, initiator only) — checks: (a) status is `blocks_pending`, (b) at least 1 approved/edited block, (c) `careModeActive(initiator) === false` AND `careModeActive(target) === false`. Generates a consultive invitation message using LOVE, persists it as an assistant message on **B's side**, transitions conflict to `ponte_invited`.
  - `POST /conflicts/:id/ponte/respond` (auth, target only) accepts `{ accept: boolean }`. On accept → status `ponte_accepted` then `collecting_b`; on decline → status `ponte_declined`.
  - `GET /conflicts/:id/authorized-summary` (auth, target only, requires status ≥ `ponte_invited`) — returns the approved/edited blocks so B can decide before accepting.
  - Care mode gate returns 403 `CARE_MODE_ACTIVE` with a specific `SAFETY_EMERGENCY_MESSAGE`-style message.

- [ ] **Step 1: Create `src/modules/conflicts/ponte.ts`**

```ts
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { getLlmProvider, type LlmMessage } from '../../ai/llm.js';
import { careModeActive } from '../profile/safety-screening.js';
import { authorizedBlocks } from './blocks.js';
import type { ConflictStatus } from './schema.js';

const CARE_MODE_MESSAGE = [
  'Percebi (por informações da triagem de segurança) que existe uma vulnerabilidade nesta relação que pede cuidado especial.',
  'A mediação por blocos entre parceiros NÃO é o caminho seguro aqui.',
  '',
  'Por favor, procure apoio especializado antes de qualquer conversa mediada:',
  '• CVV — Centro de Valorização da Vida: 188 (24h, gratuito)',
  '• Ligue 180 — Central de Atendimento à Mulher (24h)',
  '• Um(a) psicólogo(a) ou terapeuta de casal presencial',
].join('\n');

const B_APPROACH_SYSTEM = [
  'Você é LOVE, mediadora do LOVE Casal. Você NÃO é psicóloga nem terapeuta.',
  '',
  'Sua tarefa: escrever UMA mensagem curta para a pessoa B abrindo uma conversa.',
  'A pessoa A conversou com você e autorizou os blocos abaixo a serem compartilhados.',
  '',
  'Regras absolutas:',
  '1. Tom consultivo, acolhedor. NUNCA acusatório.',
  '2. NÃO diga "A disse que você é X" — apresente como perspectiva de A, não julgamento sobre B.',
  '3. Convide B a compartilhar a perspectiva dele/dela, sem pressão.',
  '4. Deixe claro que é opcional aceitar essa conversa.',
  '5. NÃO cite estatísticas nem estudos aqui — esta é uma mensagem de abertura, não análise.',
  '6. Máximo 4 parágrafos curtos.',
].join('\n');

export const ponteRespondInput = z.object({ accept: z.boolean() }).strict();
export type PonteRespondInput = z.infer<typeof ponteRespondInput>;

async function assertInitiator(userId: string, conflictId: string) {
  const c = await prisma.conflict.findUnique({ where: { id: conflictId } });
  if (!c) throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  if (c.initiatorId !== userId) throw new AppError('NOT_INITIATOR', 'Apenas quem abriu pode fazer isso', 403);
  return c;
}

async function assertTarget(userId: string, conflictId: string) {
  const c = await prisma.conflict.findUnique({ where: { id: conflictId } });
  if (!c) throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  if (c.targetId !== userId) throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  return c;
}

export async function openPonte(userId: string, conflictId: string) {
  const conflict = await assertInitiator(userId, conflictId);
  if (conflict.status !== 'blocks_pending') {
    throw new AppError('WRONG_STATUS', `Ponte só pode ser aberta em blocks_pending (atual: ${conflict.status})`, 400);
  }
  const blocks = await authorizedBlocks(conflictId);
  if (blocks.length === 0) {
    throw new AppError('NO_APPROVED_BLOCKS', 'Aprove ao menos um bloco antes de abrir a ponte', 400);
  }

  const [aCare, bCare] = await Promise.all([
    careModeActive(conflict.initiatorId),
    careModeActive(conflict.targetId),
  ]);
  if (aCare || bCare) {
    throw new AppError('CARE_MODE_ACTIVE', CARE_MODE_MESSAGE, 403);
  }

  const blocksText = blocks.map((b, i) => `[${i + 1}] ${b.content}`).join('\n');
  const messages: LlmMessage[] = [
    {
      role: 'user',
      content: `Aqui estão os blocos autorizados pela pessoa A:\n\n${blocksText}\n\nEscreva agora sua mensagem para a pessoa B.`,
    },
  ];
  const llm = await getLlmProvider().complete(messages, { system: B_APPROACH_SYSTEM, maxTokens: 800 });

  return prisma.$transaction(async (tx) => {
    await tx.conflictMessage.create({
      data: {
        conflictId,
        side: 'B',
        authorId: conflict.targetId,
        role: 'assistant',
        content: llm.text,
      },
    });
    return tx.conflict.update({ where: { id: conflictId }, data: { status: 'ponte_invited' } });
  });
}

export async function respondPonte(userId: string, conflictId: string, input: PonteRespondInput) {
  const conflict = await assertTarget(userId, conflictId);
  if (conflict.status !== 'ponte_invited') {
    throw new AppError('WRONG_STATUS', 'Nada pendente pra responder aqui', 400);
  }
  const nextStatus: ConflictStatus = input.accept ? 'collecting_b' : 'ponte_declined';
  return prisma.conflict.update({ where: { id: conflictId }, data: { status: nextStatus } });
}

export async function getAuthorizedSummary(userId: string, conflictId: string) {
  const conflict = await assertTarget(userId, conflictId);
  const opened: readonly ConflictStatus[] = [
    'ponte_invited',
    'ponte_accepted',
    'collecting_b',
    'cross_referenced',
    'closed',
  ];
  if (!opened.includes(conflict.status as ConflictStatus)) {
    throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  }
  const blocks = await authorizedBlocks(conflictId);
  return { blocks: blocks.map((b) => ({ order: b.order, content: b.content })) };
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/modules/conflicts/ponte.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';
import { MemoryLlmProvider, setLlmProvider } from '../../ai/llm.js';

const llm = new MemoryLlmProvider();
const app = await buildApp();

async function makeUser(email: string, phone: string) {
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
async function grantDisclaimer(token: string) {
  await app.inject({
    method: 'POST',
    url: '/consent',
    headers: { authorization: `Bearer ${token}` },
    payload: { scope: 'disclaimer_love_not_therapist', version: '1' },
  });
}
async function pairAndOpenWithApprovedBlocks() {
  const aTok = await makeUser('a@x.com', '+5511900000090');
  const bTok = await makeUser('b@x.com', '+5511900000091');
  await grantDisclaimer(aTok);
  await grantDisclaimer(bTok);
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
  llm.enqueue('r1');
  const c = await app.inject({
    method: 'POST',
    url: '/conflicts',
    headers: { authorization: `Bearer ${aTok}` },
    payload: { initialContent: 'briga por dinheiro' },
  });
  const conflictId = c.json().id;
  llm.enqueue(JSON.stringify(['bloco 1', 'bloco 2', 'bloco 3']));
  const gen = await app.inject({
    method: 'POST',
    url: `/conflicts/${conflictId}/blocks/generate`,
    headers: { authorization: `Bearer ${aTok}` },
  });
  for (const b of gen.json().blocks) {
    await app.inject({
      method: 'PATCH',
      url: `/conflicts/${conflictId}/blocks/${b.id}`,
      headers: { authorization: `Bearer ${aTok}` },
      payload: { status: 'approved' },
    });
  }
  return { aTok, bTok, conflictId };
}

beforeEach(async () => {
  setLlmProvider(llm);
  llm.calls.length = 0;
  await prisma.conflictBlock.deleteMany();
  await prisma.conflictMessage.deleteMany();
  await prisma.conflict.deleteMany();
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

describe('Ponte activation + care-mode gate', () => {
  it('opens ponte, LOVE writes a B-side invitation, status becomes ponte_invited', async () => {
    const { aTok, conflictId } = await pairAndOpenWithApprovedBlocks();
    llm.enqueue('Oi B, sou a LOVE. Seu(sua) parceiro(a) conversou comigo — posso ouvir sua perspectiva?');
    const res = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/ponte/open`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ponte_invited');

    const msgs = await prisma.conflictMessage.findMany({ where: { conflictId, side: 'B' } });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('assistant');
    expect(msgs[0].content).toContain('perspectiva');
  });

  it('B sees authorized summary and accepts, moving to collecting_b', async () => {
    const { aTok, bTok, conflictId } = await pairAndOpenWithApprovedBlocks();
    llm.enqueue('Oi B');
    await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/ponte/open`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    const summary = await app.inject({
      method: 'GET',
      url: `/conflicts/${conflictId}/authorized-summary`,
      headers: { authorization: `Bearer ${bTok}` },
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().blocks).toHaveLength(3);

    const accept = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/ponte/respond`,
      headers: { authorization: `Bearer ${bTok}` },
      payload: { accept: true },
    });
    expect(accept.json().status).toBe('collecting_b');
  });

  it('blocks ponte when A has care-mode active (safety screening positive)', async () => {
    const { aTok, conflictId } = await pairAndOpenWithApprovedBlocks();
    await app.inject({
      method: 'POST',
      url: '/profile/safety-screening',
      headers: { authorization: `Bearer ${aTok}` },
      payload: {
        hasViolenceHistory: true,
        hasSuicidalIdeation: false,
        hasSubstanceAbuse: false,
        hasChildSafetyConcerns: false,
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/ponte/open`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CARE_MODE_ACTIVE');
    expect(res.json().error.message).toContain('188');
  });

  it('rejects opening ponte with no approved blocks', async () => {
    const { aTok, bTok } = await pairAndOpenWithApprovedBlocks();
    void bTok;
    // Create a fresh conflict with no approved blocks
    llm.enqueue('r');
    const c = await app.inject({
      method: 'POST',
      url: '/conflicts',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { initialContent: 'outra briga' },
    });
    const conflictId = c.json().id;
    llm.enqueue(JSON.stringify(['x', 'y', 'z']));
    await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/blocks/generate`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/ponte/open`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('NO_APPROVED_BLOCKS');
  });
});
```

- [ ] **Step 3: Add ponte routes in `src/modules/conflicts/routes.ts`**

Add imports:
```ts
import { getAuthorizedSummary, openPonte, ponteRespondInput, respondPonte } from './ponte.js';
```

Inside `conflictsRoutes`:
```ts
  app.post<{ Params: { id: string } }>(
    '/conflicts/:id/ponte/open',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(200).send(await openPonte(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/conflicts/:id/ponte/respond',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const input = ponteRespondInput.parse(req.body);
        return reply.code(200).send(await respondPonte(req.userId!, req.params.id, input));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/conflicts/:id/authorized-summary',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(200).send(await getAuthorizedSummary(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 4 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/conflicts/
git commit -m "feat(conflicts): ponte activation with care-mode gate + B accepts/declines"
```

---

### Task 4: B's side conversation with LOVE + cross-reference insights

**Files:**
- Create: `src/modules/conflicts/cross-ref.ts`, `src/modules/conflicts/b-side-and-crossref.test.ts`
- Modify: `src/modules/conflicts/routes.ts` (add cross-reference endpoint), `src/modules/conflicts/service.ts` (message posting already covers B once status='collecting_b' — verify tests exercise this)

**Interfaces:**
- Consumes: `getLlmProvider`, existing conflict/messages infrastructure.
- Produces:
  - After `respondPonte({accept: true})` moves status to `collecting_b`, B can now `POST /conflicts/:id/messages` (already implemented in Task 1 by `canPost`).
  - `POST /conflicts/:id/cross-reference` (auth, initiator only, requires status='collecting_b' with at least 1 B-user message) — takes A's transcript + B's transcript, calls LOVE with a **structured** prompt that returns JSON: `{ commonGround: string, aInsight: string, bInsight: string, patterns: string[] }`. Persists as two assistant messages: `aInsight` on A's side, `bInsight` on B's side. Transitions status to `cross_referenced`. Returns `{ commonGround, patterns, mySideInsight }`.
  - `GET /conflicts/:id/insight` (auth, either side) returns the persisted insight for the caller's side only.
  - The `commonGround` + `patterns` fields are safe to expose to both sides (they describe the interaction, not private content).

- [ ] **Step 1: Create `src/modules/conflicts/cross-ref.ts`**

```ts
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { getLlmProvider, type LlmMessage } from '../../ai/llm.js';
import type { ConflictStatus } from './schema.js';

const CROSS_REF_SYSTEM = [
  'Você é LOVE, mediadora do LOVE Casal. NÃO é psicóloga nem terapeuta.',
  '',
  'Você tem acesso à conversa que teve com A e à conversa que teve com B sobre o MESMO conflito.',
  'Sua tarefa: fazer um cruzamento e devolver um JSON com quatro chaves:',
  '',
  '- "commonGround": 1-3 frases sobre pontos onde A e B parecem concordar (ou compartilhar preocupação).',
  '- "patterns": array de 1-4 padrões observados na interação (ex: "ambos falam sobre segurança financeira sob rótulos diferentes").',
  '- "aInsight": mensagem PRIVADA para A (1-3 parágrafos, tom acolhedor, sem citar frases literais de B, sem julgamento).',
  '- "bInsight": mensagem PRIVADA para B (idem).',
  '',
  'Regras absolutas:',
  '1. Cada insight fala com um dos dois — nunca revele frases da conversa privada do outro.',
  '2. NÃO tome partido. NÃO diga quem está "certo".',
  '3. Fale em opções e observações, nunca em ordens.',
  '4. NÃO cite estatísticas nem estudos aqui.',
  '5. Responda APENAS com o JSON. Nada antes ou depois.',
].join('\n');

async function assertInitiator(userId: string, conflictId: string) {
  const c = await prisma.conflict.findUnique({ where: { id: conflictId } });
  if (!c) throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  if (c.initiatorId !== userId) throw new AppError('NOT_INITIATOR', 'Apenas quem abriu pode fazer isso', 403);
  return c;
}
async function assertParticipant(userId: string, conflictId: string) {
  const c = await prisma.conflict.findUnique({ where: { id: conflictId } });
  if (!c) throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  if (c.initiatorId !== userId && c.targetId !== userId) {
    throw new AppError('NOT_FOUND', 'Conflito não encontrado', 404);
  }
  return c;
}

function tryParseCross(text: string): { commonGround: string; patterns: string[]; aInsight: string; bInsight: string } {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM did not return an object');
  const obj: unknown = JSON.parse(match[0]);
  const o = obj as Record<string, unknown>;
  if (
    typeof o.commonGround !== 'string' ||
    !Array.isArray(o.patterns) ||
    !o.patterns.every((p) => typeof p === 'string') ||
    typeof o.aInsight !== 'string' ||
    typeof o.bInsight !== 'string'
  ) {
    throw new Error('LLM returned object of wrong shape');
  }
  return {
    commonGround: o.commonGround,
    patterns: o.patterns as string[],
    aInsight: o.aInsight,
    bInsight: o.bInsight,
  };
}

export async function crossReference(userId: string, conflictId: string) {
  const conflict = await assertInitiator(userId, conflictId);
  if (conflict.status !== 'collecting_b') {
    throw new AppError(
      'WRONG_STATUS',
      `Cruzamento só pode acontecer em collecting_b (atual: ${conflict.status})`,
      400,
    );
  }
  const aMsgs = await prisma.conflictMessage.findMany({
    where: { conflictId, side: 'A' },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  });
  const bMsgs = await prisma.conflictMessage.findMany({
    where: { conflictId, side: 'B' },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  });
  const bUserMsgs = bMsgs.filter((m) => m.role === 'user');
  if (bUserMsgs.length === 0) {
    throw new AppError('B_HAS_NOT_SPOKEN', 'B ainda não compartilhou nada — aguarde.', 400);
  }

  const transcript = [
    '=== Conversa com A ===',
    ...aMsgs.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
    '',
    '=== Conversa com B ===',
    ...bMsgs.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
  ].join('\n');

  const messages: LlmMessage[] = [{ role: 'user', content: transcript }];
  const llm = await getLlmProvider().complete(messages, { system: CROSS_REF_SYSTEM, maxTokens: 2000 });

  let parsed: { commonGround: string; patterns: string[]; aInsight: string; bInsight: string };
  try {
    parsed = tryParseCross(llm.text);
  } catch (e) {
    throw new AppError('CROSSREF_PARSE_FAILED', `Cruzamento falhou: ${(e as Error).message}`, 500);
  }

  return prisma.$transaction(async (tx) => {
    await tx.conflictMessage.create({
      data: {
        conflictId,
        side: 'A',
        authorId: conflict.initiatorId,
        role: 'assistant',
        content: parsed.aInsight,
      },
    });
    await tx.conflictMessage.create({
      data: {
        conflictId,
        side: 'B',
        authorId: conflict.targetId,
        role: 'assistant',
        content: parsed.bInsight,
      },
    });
    await tx.conflict.update({ where: { id: conflictId }, data: { status: 'cross_referenced' } });
    return {
      commonGround: parsed.commonGround,
      patterns: parsed.patterns,
      mySideInsight: parsed.aInsight,
    };
  });
}

export async function getInsight(userId: string, conflictId: string) {
  const conflict = await assertParticipant(userId, conflictId);
  const okStatuses: readonly ConflictStatus[] = ['cross_referenced', 'closed'];
  if (!okStatuses.includes(conflict.status as ConflictStatus)) {
    throw new AppError('NOT_YET', 'Ainda não há insight cruzado neste conflito', 400);
  }
  const side = conflict.initiatorId === userId ? 'A' : 'B';
  const insight = await prisma.conflictMessage.findFirst({
    where: { conflictId, side, role: 'assistant' },
    orderBy: { createdAt: 'desc' },
    select: { content: true, createdAt: true },
  });
  if (!insight) throw new AppError('NOT_YET', 'Ainda não há insight cruzado', 400);
  return { insight: insight.content, at: insight.createdAt };
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/modules/conflicts/b-side-and-crossref.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';
import { MemoryLlmProvider, setLlmProvider } from '../../ai/llm.js';

const llm = new MemoryLlmProvider();
const app = await buildApp();

async function makeUser(email: string, phone: string) {
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
async function grantDisclaimer(token: string) {
  await app.inject({
    method: 'POST',
    url: '/consent',
    headers: { authorization: `Bearer ${token}` },
    payload: { scope: 'disclaimer_love_not_therapist', version: '1' },
  });
}
async function fullFlowUpToBCollecting(): Promise<{ aTok: string; bTok: string; conflictId: string }> {
  const aTok = await makeUser('a@x.com', '+5511900000100');
  const bTok = await makeUser('b@x.com', '+5511900000101');
  await grantDisclaimer(aTok);
  await grantDisclaimer(bTok);
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
  llm.enqueue('r');
  const c = await app.inject({
    method: 'POST',
    url: '/conflicts',
    headers: { authorization: `Bearer ${aTok}` },
    payload: { initialContent: 'briga por dinheiro' },
  });
  const conflictId = c.json().id;
  llm.enqueue(JSON.stringify(['b1', 'b2', 'b3']));
  const gen = await app.inject({
    method: 'POST',
    url: `/conflicts/${conflictId}/blocks/generate`,
    headers: { authorization: `Bearer ${aTok}` },
  });
  for (const b of gen.json().blocks) {
    await app.inject({
      method: 'PATCH',
      url: `/conflicts/${conflictId}/blocks/${b.id}`,
      headers: { authorization: `Bearer ${aTok}` },
      payload: { status: 'approved' },
    });
  }
  llm.enqueue('convite pra B');
  await app.inject({
    method: 'POST',
    url: `/conflicts/${conflictId}/ponte/open`,
    headers: { authorization: `Bearer ${aTok}` },
  });
  await app.inject({
    method: 'POST',
    url: `/conflicts/${conflictId}/ponte/respond`,
    headers: { authorization: `Bearer ${bTok}` },
    payload: { accept: true },
  });
  return { aTok, bTok, conflictId };
}

beforeEach(async () => {
  setLlmProvider(llm);
  llm.calls.length = 0;
  await prisma.conflictBlock.deleteMany();
  await prisma.conflictMessage.deleteMany();
  await prisma.conflict.deleteMany();
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

describe('B-side conversation + cross-reference', () => {
  it('B can post messages once status=collecting_b; A gets blocked from B side reads', async () => {
    const { aTok, bTok, conflictId } = await fullFlowUpToBCollecting();
    llm.enqueue('resposta pra B');
    const res = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/messages`,
      headers: { authorization: `Bearer ${bTok}` },
      payload: { content: 'aqui é a minha versão' },
    });
    expect(res.statusCode).toBe(201);

    // A viewing the conflict must NOT see B's messages
    const aView = await app.inject({
      method: 'GET',
      url: `/conflicts/${conflictId}`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    for (const m of aView.json().messages) expect(m.side).toBe('A');
  });

  it('cross-reference stores per-side insights and returns commonGround+patterns', async () => {
    const { aTok, bTok, conflictId } = await fullFlowUpToBCollecting();
    llm.enqueue('resposta pra B');
    await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/messages`,
      headers: { authorization: `Bearer ${bTok}` },
      payload: { content: 'aqui é a minha versão' },
    });

    const crossOut = JSON.stringify({
      commonGround: 'Ambos se importam com estabilidade financeira.',
      patterns: ['os dois falam sobre segurança, sob rótulos diferentes'],
      aInsight: 'insight privado pra A',
      bInsight: 'insight privado pra B',
    });
    llm.enqueue(crossOut);
    const res = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/cross-reference`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().commonGround).toContain('estabilidade');
    expect(res.json().mySideInsight).toBe('insight privado pra A');

    const bInsight = await app.inject({
      method: 'GET',
      url: `/conflicts/${conflictId}/insight`,
      headers: { authorization: `Bearer ${bTok}` },
    });
    expect(bInsight.json().insight).toBe('insight privado pra B');

    const aInsight = await app.inject({
      method: 'GET',
      url: `/conflicts/${conflictId}/insight`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(aInsight.json().insight).toBe('insight privado pra A');
  });

  it('cross-reference rejects if B has not spoken', async () => {
    const { aTok, conflictId } = await fullFlowUpToBCollecting();
    const res = await app.inject({
      method: 'POST',
      url: `/conflicts/${conflictId}/cross-reference`,
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('B_HAS_NOT_SPOKEN');
  });
});
```

- [ ] **Step 3: Add cross-reference routes in `src/modules/conflicts/routes.ts`**

Add imports:
```ts
import { crossReference, getInsight } from './cross-ref.js';
```

Inside `conflictsRoutes`:
```ts
  app.post<{ Params: { id: string } }>(
    '/conflicts/:id/cross-reference',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(200).send(await crossReference(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/conflicts/:id/insight',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        return reply.code(200).send(await getInsight(req.userId!, req.params.id));
      } catch (err) {
        return handle(err, reply, req.log);
      }
    },
  );
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 3 new tests pass. Full ponte flow now covered end-to-end.

- [ ] **Step 5: Commit**

```bash
git add src/modules/conflicts/
git commit -m "feat(conflicts): B talks to LOVE + cross-reference produces per-side private insights"
```

---

## Self-Review Notes

- **Spec coverage:** covers spec §2.3 (modo conflito — extended beyond the single-user version done in Plan 2) and §2.4 (ponte por blocos — the whole flow: A summary → block-by-block consent → LOVE approaches B → cross-reference). Spec §2.6 (sessão semanal em voz) and §2.13 (modo separação) remain out — the former needs a media layer (v1.5), the latter is a small extension of `/love/chat` behavior and can land later as a small task.
- **Placeholder scan:** none. Every step is complete code.
- **Type consistency:** `ConflictStatus` union defined once in `schema.ts` and imported by service, ponte, and cross-ref. `BlockRow` interface exported from `blocks.ts` for the ponte to consume via `authorizedBlocks`. `careModeActive` is the one hook into Plan 3.
- **Cross-side isolation:** the entire plan enforces the invariant three ways: (1) `getConflict` filters `where: {conflictId, side}`; (2) `updateBlock`/`generateBlocks` gate on `assertInitiator` (only A); (3) `getInsight` scopes the query to the caller's side. B never has an endpoint that returns A's raw content — only the approved blocks via `authorized-summary`.
- **Care mode:** enforced at the single choke point of `openPonte`. Both partners' `careModeActive` is checked. Positive → 403 with a message that includes the hotlines from Plan 2.
- **LLM output parsing:** blocks and cross-reference outputs are JSON. Both use permissive regex-then-JSON.parse to survive small LLM chatter around the JSON, with typed errors (`BLOCK_GEN_FAILED`, `CROSSREF_PARSE_FAILED`) so the client can react.
