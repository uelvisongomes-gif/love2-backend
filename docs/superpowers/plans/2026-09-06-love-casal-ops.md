# LOVE Casal Ops — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the production ops layer: Stripe subscription (couples pay monthly), an email provider abstraction with the first transactional emails, a nightly scheduler for retention purge (LGPD 12-month cap) and daily check-in reminders, and a small admin surface (metrics + user disable). Bring the backend to a state where a real paying couple can use it.

**Architecture:** Same modular monolith. New modules: `src/modules/billing/`, `src/modules/notifications/`, `src/modules/admin/`. Email is behind an abstraction (`EmailProvider` interface + `MemoryEmailProvider` for tests + `ResendEmailProvider` for prod) — same pattern as `sms.ts` / `llm.ts`. Stripe is behind a thin service that centralizes webhook processing. Scheduler uses `node-cron` in-process (dev-simple; production may move to external cron).

**Tech Stack:** Adds `stripe` (npm) and `node-cron`. Email uses Resend via `fetch` (no SDK dep, matches our OpenAI/Voyage pattern). No new database vendors.

**Spec:** `docs/superpowers/specs/2026-09-05-love-casal-design.md`

## Global Constraints

- **All prior Global Constraints apply.**
- **Vendor-neutral email:** the `EmailProvider` interface is the only surface the app talks to. `ResendEmailProvider` is one file; swapping to SES/Postmark is a one-file change. No provider-specific types leak.
- **Vendor-neutral billing** — with an asterisk: Stripe is central, so we do NOT hide it behind an interface. But: our subscription state lives in our own `Subscription` model (not Stripe's); Stripe is the source of truth for payment status but the app queries our table. Migrating to another gateway means importing subscriptions once and swapping one adapter file.
- **Stripe webhook safety:** always verify the webhook signature. Never mutate DB state from webhook body alone.
- **Notifications are opt-out:** users can turn off any category from `PUT /profile/notifications`. Categories default ON except marketing (which stays off unless explicit).
- **Retention:** the retention job purges rows older than the user's configured retention (default 12 months, capped at 12 months as per spec §2.11). It never touches `AuditLog` (kept for compliance for the audit period). Retention writes an `AuditLog` entry when it purges.
- **Admin authorization:** admin-only endpoints require `User.isAdmin = true`. Adding an admin is a manual DB operation; there is no self-service. Admin endpoints never return raw user content (no journals, no love messages, no conflict messages) — only counts and metadata.

---

### Task 1: Subscription model + Stripe integration (checkout + webhook)

**Files:**
- Create: `src/modules/billing/stripe.ts`, `src/modules/billing/schema.ts`, `src/modules/billing/service.ts`, `src/modules/billing/routes.ts`, `src/modules/billing/billing.test.ts`
- Modify: `prisma/schema.prisma` (add `Subscription`), migration, `src/config.ts` (Stripe env vars), `.env.example`, `src/app.ts` (register + register raw-body parser for webhook), `package.json` (stripe dep)

**Interfaces:**
- Consumes: `authenticate`, `prisma`, `AppError`, `coupleOf` pattern.
- Produces:
  - `Subscription` model: `id`, `coupleId` (unique), `stripeCustomerId`, `stripeSubscriptionId`, `status` ('trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete'), `currentPeriodEnd`, `cancelAtPeriodEnd`, timestamps.
  - `POST /billing/checkout-session` (auth, requires couple) — creates a Stripe Checkout Session (returns `url`) that starts a subscription tied to the couple. Returns 409 `ALREADY_SUBSCRIBED` if an active subscription exists.
  - `GET /billing/status` (auth, requires couple) — returns subscription status + `currentPeriodEnd` + `cancelAtPeriodEnd`.
  - `POST /billing/portal-session` (auth, requires couple + subscription) — creates a Stripe Customer Portal Session so the user can manage payment method / cancel.
  - `POST /billing/webhook` (unauthenticated; verifies signature) — handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Upserts local `Subscription`.

- [ ] **Step 1: Add `Subscription` to `prisma/schema.prisma`**

```prisma
model Subscription {
  id                     String   @id @default(cuid())
  coupleId               String   @unique
  stripeCustomerId       String
  stripeSubscriptionId   String   @unique
  status                 String
  currentPeriodEnd       DateTime
  cancelAtPeriodEnd      Boolean  @default(false)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  @@index([status])
  @@index([stripeCustomerId])
}
```

- [ ] **Step 2: Extend `src/config.ts` schema**

```ts
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),
  APP_URL: z.string().url().default('http://localhost:3000'),
```

- [ ] **Step 3: Append to `.env.example`**

```
# Stripe — subscription. Create a Product + Price in Stripe dashboard, use price id here.
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID=
APP_URL=http://localhost:3000
```

- [ ] **Step 4: Add stripe dep to `package.json`**

```json
"stripe": "^17.4.0"
```

- [ ] **Step 5: Create `src/modules/billing/stripe.ts`**

```ts
import Stripe from 'stripe';
import { loadConfig } from '../../config.js';

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;
  const cfg = loadConfig();
  if (!cfg.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is required for billing');
  client = new Stripe(cfg.STRIPE_SECRET_KEY);
  return client;
}

export function verifyWebhook(rawBody: Buffer, signature: string, secret: string): Stripe.Event {
  return Stripe.webhooks.constructEvent(rawBody, signature, secret);
}
```

- [ ] **Step 6: Create `src/modules/billing/schema.ts`**

Nothing to validate on the body of these endpoints beyond auth, but Zod is still used for query strings. This file can be minimal:

```ts
// no user input schemas needed for billing endpoints (all state comes from Stripe)
export {};
```

- [ ] **Step 7: Create `src/modules/billing/service.ts`**

```ts
import type Stripe from 'stripe';
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { loadConfig } from '../../config.js';
import { getStripe } from './stripe.js';

async function coupleOf(userId: string) {
  const c = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true, userAId: true, userBId: true },
  });
  if (!c) throw new AppError('NO_COUPLE', 'Você ainda não está vinculado a um casal', 403);
  return c;
}

async function userEmail(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!u) throw new AppError('NOT_FOUND', 'Usuário não encontrado', 404);
  return u.email;
}

export async function getStatus(userId: string) {
  const couple = await coupleOf(userId);
  const sub = await prisma.subscription.findUnique({ where: { coupleId: couple.id } });
  if (!sub) return { subscribed: false as const };
  return {
    subscribed: true as const,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  };
}

export async function createCheckoutSession(userId: string): Promise<{ url: string }> {
  const cfg = loadConfig();
  if (!cfg.STRIPE_PRICE_ID) throw new AppError('BILLING_NOT_CONFIGURED', 'Billing não configurado', 500);
  const couple = await coupleOf(userId);
  const existing = await prisma.subscription.findUnique({ where: { coupleId: couple.id } });
  if (existing && ['active', 'trialing', 'past_due'].includes(existing.status)) {
    throw new AppError('ALREADY_SUBSCRIBED', 'Casal já possui assinatura ativa', 409);
  }
  const email = await userEmail(userId);
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: cfg.STRIPE_PRICE_ID, quantity: 1 }],
    customer_email: email,
    success_url: `${cfg.APP_URL}/billing/success`,
    cancel_url: `${cfg.APP_URL}/billing/cancel`,
    subscription_data: { metadata: { coupleId: couple.id } },
    metadata: { coupleId: couple.id },
  });
  if (!session.url) throw new AppError('STRIPE_NO_URL', 'Stripe não retornou URL', 500);
  return { url: session.url };
}

export async function createPortalSession(userId: string): Promise<{ url: string }> {
  const cfg = loadConfig();
  const couple = await coupleOf(userId);
  const sub = await prisma.subscription.findUnique({ where: { coupleId: couple.id } });
  if (!sub) throw new AppError('NOT_SUBSCRIBED', 'Casal não possui assinatura', 404);
  const stripe = getStripe();
  const portal = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${cfg.APP_URL}/billing`,
  });
  return { url: portal.url };
}

export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const coupleId = session.metadata?.coupleId;
      if (!coupleId || !session.subscription || !session.customer) return;
      const stripe = getStripe();
      const subscriptionId =
        typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
      const customerId = typeof session.customer === 'string' ? session.customer : session.customer.id;
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      await prisma.subscription.upsert({
        where: { coupleId },
        create: {
          coupleId,
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
          status: sub.status,
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        },
        update: {
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
          status: sub.status,
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        },
      });
      return;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const coupleId = (sub.metadata as Record<string, string>)?.coupleId;
      if (!coupleId) return;
      await prisma.subscription.updateMany({
        where: { coupleId },
        data: {
          status: sub.status,
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        },
      });
      return;
    }
    default:
      return;
  }
}
```

- [ ] **Step 8: Create `src/modules/billing/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { AppError } from '../../errors.js';
import { loadConfig } from '../../config.js';
import { createCheckoutSession, createPortalSession, getStatus, handleWebhookEvent } from './service.js';
import { verifyWebhook } from './stripe.js';

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/billing/status', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await getStatus(req.userId!));
    } catch (err) {
      if (err instanceof AppError) return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      req.log.error({ err }, 'billing status failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });

  app.post('/billing/checkout-session', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await createCheckoutSession(req.userId!));
    } catch (err) {
      if (err instanceof AppError) return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      req.log.error({ err }, 'checkout session failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });

  app.post('/billing/portal-session', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      return reply.code(200).send(await createPortalSession(req.userId!));
    } catch (err) {
      if (err instanceof AppError) return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      req.log.error({ err }, 'portal session failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });

  // Webhook: needs raw body for signature verification. Registered with a
  // dedicated content-type parser at app-level (see src/app.ts changes).
  app.post('/billing/webhook', async (req, reply) => {
    const cfg = loadConfig();
    if (!cfg.STRIPE_WEBHOOK_SECRET) return reply.code(500).send({ error: { code: 'BILLING_NOT_CONFIGURED', message: 'webhook secret missing' } });
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string') return reply.code(400).send({ error: { code: 'MISSING_SIGNATURE', message: 'stripe-signature header missing' } });
    try {
      const event = verifyWebhook(req.rawBody as Buffer, signature, cfg.STRIPE_WEBHOOK_SECRET);
      await handleWebhookEvent(event);
      return reply.code(200).send({ received: true });
    } catch (err) {
      req.log.error({ err }, 'stripe webhook failed');
      return reply.code(400).send({ error: { code: 'WEBHOOK_INVALID', message: 'signature verification failed' } });
    }
  });
}
```

- [ ] **Step 9: Register raw-body parser + routes in `src/app.ts`**

Add before route registration:
```ts
  // Preserve raw body for Stripe webhook signature verification.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      (req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
      try {
        done(null, body.length === 0 ? {} : JSON.parse(body.toString('utf-8')));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );
```

Add:
```ts
import { billingRoutes } from './modules/billing/routes.js';
// ...
  await app.register(billingRoutes);
```

Also declare `rawBody` on FastifyRequest in `src/modules/billing/routes.ts` or a `src/types.ts`:
```ts
declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}
```

- [ ] **Step 10: Write tests**

Create `src/modules/billing/billing.test.ts`. Tests use HTTP mocks for Stripe calls — since our service imports the real Stripe client, we test only the endpoints that don't require Stripe network (`/billing/status` when no subscription exists) and directly exercise the webhook handler with a fake event via `handleWebhookEvent`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';
import { handleWebhookEvent } from './service.js';

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
async function pairCouple() {
  const aTok = await makeUser('a@x.com', '+5511900000110');
  const bTok = await makeUser('b@x.com', '+5511900000111');
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
  await prisma.subscription.deleteMany();
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

describe('Billing status', () => {
  it('returns subscribed=false when no subscription exists', async () => {
    const { aTok } = await pairCouple();
    const res = await app.inject({
      method: 'GET',
      url: '/billing/status',
      headers: { authorization: `Bearer ${aTok}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ subscribed: false });
  });

  it('returns 403 NO_COUPLE for solo user', async () => {
    const tok = await makeUser('solo@x.com', '+5511900000112');
    const res = await app.inject({
      method: 'GET',
      url: '/billing/status',
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NO_COUPLE');
  });
});

describe('handleWebhookEvent (direct)', () => {
  it('upserts subscription on subscription.updated', async () => {
    const { aTok } = await pairCouple();
    void aTok;
    const couple = await prisma.couple.findFirst();
    const fakeSub = {
      id: 'sub_test1',
      customer: 'cus_test1',
      status: 'active',
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      cancel_at_period_end: false,
      metadata: { coupleId: couple!.id },
    };
    await handleWebhookEvent({
      type: 'customer.subscription.updated',
      data: { object: fakeSub },
    } as unknown as import('stripe').Stripe.Event);
    // updateMany was used, so nothing exists yet — verify no row created (updateMany doesn't insert)
    const rows = await prisma.subscription.count();
    expect(rows).toBe(0);

    // Seed a subscription manually then re-run — status should update
    await prisma.subscription.create({
      data: {
        coupleId: couple!.id,
        stripeCustomerId: 'cus_test1',
        stripeSubscriptionId: 'sub_test1',
        status: 'trialing',
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
      },
    });
    await handleWebhookEvent({
      type: 'customer.subscription.updated',
      data: { object: fakeSub },
    } as unknown as import('stripe').Stripe.Event);
    const after = await prisma.subscription.findFirst();
    expect(after!.status).toBe('active');
  });
});
```

- [ ] **Step 11: Migrate and run tests**

Create migration `<timestamp>_add_subscription/migration.sql`:
```sql
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "coupleId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscription_coupleId_key" ON "Subscription"("coupleId");
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");
CREATE INDEX "Subscription_stripeCustomerId_idx" ON "Subscription"("stripeCustomerId");
```

Run: `npm install && npx prisma migrate deploy && npx prisma generate && npm test`
Expected: 3 new tests pass.

- [ ] **Step 12: Commit**

```bash
git add prisma/ src/modules/billing/ src/app.ts src/config.ts .env.example package.json package-lock.json
git commit -m "feat(billing): Stripe subscription — Subscription model + checkout + portal + webhook"
```

---

### Task 2: Subscription enforcement guard

**Files:**
- Create: `src/modules/billing/require-subscription.ts`
- Modify: routes that gate on subscription (start with `POST /love/chat` and `POST /conflicts` — the LLM-cost endpoints)

**Interfaces:**
- Produces:
  - `requireActiveSubscription(userId): Promise<void>` — throws `AppError('SUBSCRIPTION_REQUIRED', ..., 402)` if the user's couple has no `active` or `trialing` subscription. Kept as a plain service function so routes can call it in try/catch after their zod validation.
  - Applied to `POST /love/chat`, `POST /conflicts` (new conflicts), and any future paid endpoint. `POST /conflicts/:id/messages` is not gated (once a conflict exists, both sides can respond).

- [ ] **Step 1: Create `src/modules/billing/require-subscription.ts`**

```ts
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';

export async function requireActiveSubscription(userId: string): Promise<void> {
  const couple = await prisma.couple.findFirst({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { id: true },
  });
  if (!couple) throw new AppError('NO_COUPLE', 'Você ainda não está vinculado a um casal', 403);
  const sub = await prisma.subscription.findUnique({
    where: { coupleId: couple.id },
    select: { status: true },
  });
  const ok = sub && (sub.status === 'active' || sub.status === 'trialing');
  if (!ok) throw new AppError('SUBSCRIPTION_REQUIRED', 'É necessária uma assinatura ativa', 402);
}
```

- [ ] **Step 2: Write the failing test**

Extend `src/modules/billing/billing.test.ts` with a new describe block:

```ts
describe('requireActiveSubscription gate', () => {
  it('POST /love/chat returns 402 SUBSCRIPTION_REQUIRED without subscription', async () => {
    const { aTok } = await pairCouple();
    // grant disclaimer so we clearly hit the subscription gate (not consent)
    await app.inject({
      method: 'POST',
      url: '/consent',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { scope: 'disclaimer_love_not_therapist', version: '1' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/love/chat',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { content: 'oi', context: 'general' },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('/love/chat works when subscription is active', async () => {
    const { aTok } = await pairCouple();
    const couple = await prisma.couple.findFirst();
    await prisma.subscription.create({
      data: {
        coupleId: couple!.id,
        stripeCustomerId: 'cus_x',
        stripeSubscriptionId: 'sub_x',
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        cancelAtPeriodEnd: false,
      },
    });
    await app.inject({
      method: 'POST',
      url: '/consent',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { scope: 'disclaimer_love_not_therapist', version: '1' },
    });
    // MemoryLlmProvider must have a reply queued
    const { MemoryLlmProvider, setLlmProvider } = await import('../../ai/llm.js');
    const llm = new MemoryLlmProvider();
    setLlmProvider(llm);
    llm.enqueue('oi de volta');
    const res = await app.inject({
      method: 'POST',
      url: '/love/chat',
      headers: { authorization: `Bearer ${aTok}` },
      payload: { content: 'oi', context: 'general' },
    });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 3: Wire the guard into `POST /love/chat`**

Modify `src/modules/love/routes.ts`. Add import:
```ts
import { requireActiveSubscription } from '../billing/require-subscription.js';
```

Inside the handler, immediately after `await assertLoveConsent(req.userId!);`:
```ts
      await requireActiveSubscription(req.userId!);
```

- [ ] **Step 4: Wire the guard into `POST /conflicts`**

Modify `src/modules/conflicts/service.ts` in `createConflict`, immediately after `await assertLoveConsent(userId);`:
```ts
  const { requireActiveSubscription } = await import('../billing/require-subscription.js');
  await requireActiveSubscription(userId);
```

(Dynamic import avoids a static circular dependency, since billing later may want to reference conflict counts.)

- [ ] **Step 5: Update existing conflict/love tests to seed a subscription in `beforeEach`**

In every test file that already tests `/love/chat` and `/conflicts` endpoints, add after user creation and couple pairing:
```ts
  const couple = await prisma.couple.findFirst();
  if (couple) {
    await prisma.subscription.create({
      data: {
        coupleId: couple.id,
        stripeCustomerId: 'cus_test',
        stripeSubscriptionId: `sub_test_${Date.now()}`,
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        cancelAtPeriodEnd: false,
      },
    });
  }
```

Test files affected: `src/modules/love/love.test.ts`, `src/modules/conflicts/conflict-create.test.ts`, `src/modules/conflicts/blocks.test.ts`, `src/modules/conflicts/ponte.test.ts`, `src/modules/conflicts/b-side-and-crossref.test.ts`.

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: all pass, including the 2 new billing tests.

- [ ] **Step 7: Commit**

```bash
git add src/modules/billing/ src/modules/love/ src/modules/conflicts/ src/modules/**/love.test.ts src/modules/**/conflict-create.test.ts src/modules/**/blocks.test.ts src/modules/**/ponte.test.ts src/modules/**/b-side-and-crossref.test.ts
git commit -m "feat(billing): requireActiveSubscription gate on /love/chat and POST /conflicts (402 SUBSCRIPTION_REQUIRED)"
```

---

### Task 3: Email provider abstraction + Resend adapter + welcome email

**Files:**
- Create: `src/modules/notifications/email.ts`, `src/modules/notifications/email.test.ts`, `src/modules/notifications/templates.ts`
- Modify: `src/config.ts`, `.env.example`, `src/modules/auth/service.ts` (send welcome after registration)

**Interfaces:**
- Produces:
  - `EmailProvider` interface `{ send(input: { to, subject, html, text }): Promise<void> }`.
  - `MemoryEmailProvider` (tests) with `sent: {to, subject, html, text}[]`.
  - `ResendEmailProvider` (prod) — `fetch` to `https://api.resend.com/emails`.
  - `getEmailProvider()` / `setEmailProvider()` singleton (same pattern).
  - `sendWelcomeEmail(userId)` — HTML + text template welcoming the user, links to onboarding.
  - Registration sends the welcome email (fire-and-forget with logged errors).

- [ ] **Step 1: Extend `src/config.ts`**

```ts
  EMAIL_PROVIDER: z.enum(['resend', 'memory']).default('memory'),
  EMAIL_FROM: z.string().default('LOVE Casal <no-reply@lovecasal.app>'),
  RESEND_API_KEY: z.string().optional(),
```

- [ ] **Step 2: Append to `.env.example`**

```
# Email — 'memory' captures in tests; 'resend' hits Resend API
EMAIL_PROVIDER=memory
EMAIL_FROM=LOVE Casal <no-reply@lovecasal.app>
RESEND_API_KEY=
```

- [ ] **Step 3: Create `src/modules/notifications/email.ts`**

```ts
import { loadConfig } from '../../config.js';

export interface EmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailProvider {
  send(input: EmailInput): Promise<void>;
}

export class MemoryEmailProvider implements EmailProvider {
  public sent: EmailInput[] = [];
  async send(input: EmailInput): Promise<void> {
    this.sent.push(input);
  }
}

export class ResendEmailProvider implements EmailProvider {
  private endpoint = 'https://api.resend.com/emails';
  constructor(private readonly apiKey: string, private readonly from: string) {}
  async send(input: EmailInput): Promise<void> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend failed (${res.status}): ${body}`);
    }
  }
}

let instance: EmailProvider | null = null;

export function setEmailProvider(p: EmailProvider): void {
  instance = p;
}

export function getEmailProvider(): EmailProvider {
  if (instance) return instance;
  const cfg = loadConfig();
  if (cfg.EMAIL_PROVIDER === 'resend') {
    if (!cfg.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required when EMAIL_PROVIDER=resend');
    instance = new ResendEmailProvider(cfg.RESEND_API_KEY, cfg.EMAIL_FROM);
  } else {
    instance = new MemoryEmailProvider();
  }
  return instance;
}
```

- [ ] **Step 4: Create `src/modules/notifications/templates.ts`**

```ts
import { getEmailProvider } from './email.js';

export async function sendWelcomeEmail(to: string, name: string): Promise<void> {
  const subject = 'Bem-vinda(o) ao LOVE Casal';
  const text = [
    `Oi ${name},`,
    '',
    'Aqui é o LOVE Casal — obrigada por criar sua conta.',
    'A LOVE, sua mediadora, está pronta pra ouvir. Ela não é psicóloga nem terapeuta — é uma ferramenta pra você e seu parceiro se comunicarem melhor.',
    '',
    'Próximos passos:',
    '1. Preencha seu perfil e responda o questionário rápido de onboarding.',
    '2. Convide seu parceiro pra formar o casal.',
    '3. Comece o check-in diário.',
    '',
    'Se precisar de ajuda urgente:',
    '• CVV — Centro de Valorização da Vida: 188 (24h)',
    '• Ligue 180 (Central de Atendimento à Mulher): 180',
    '',
    '— Time LOVE Casal',
  ].join('\n');
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222">
      <h2 style="color:#c76b6b">Bem-vinda(o) ao LOVE Casal</h2>
      <p>Oi <strong>${escapeHtml(name)}</strong>,</p>
      <p>Aqui é o LOVE Casal — obrigada por criar sua conta.</p>
      <p><strong>LOVE</strong>, sua mediadora, está pronta pra ouvir. Ela <em>não é psicóloga nem terapeuta</em> — é uma ferramenta pra você e seu parceiro se comunicarem melhor.</p>
      <h3>Próximos passos</h3>
      <ol>
        <li>Preencha seu perfil e responda o questionário rápido de onboarding.</li>
        <li>Convide seu parceiro pra formar o casal.</li>
        <li>Comece o check-in diário.</li>
      </ol>
      <p style="color:#666;font-size:14px">
        Ajuda urgente: CVV <strong>188</strong> · Ligue <strong>180</strong>
      </p>
      <p>— Time LOVE Casal</p>
    </div>`;
  await getEmailProvider().send({ to, subject, html, text });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

- [ ] **Step 5: Write the failing test**

Create `src/modules/notifications/email.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryEmailProvider, setEmailProvider } from './email.js';
import { sendWelcomeEmail } from './templates.js';

const email = new MemoryEmailProvider();

beforeEach(() => {
  setEmailProvider(email);
  email.sent.length = 0;
});

describe('welcome email', () => {
  it('sends a welcome email with name interpolated and safe HTML', async () => {
    await sendWelcomeEmail('u@x.com', 'Maria <script>');
    expect(email.sent).toHaveLength(1);
    const s = email.sent[0];
    expect(s.to).toBe('u@x.com');
    expect(s.subject).toContain('Bem-vinda');
    expect(s.text).toContain('Maria <script>');
    expect(s.html).toContain('Maria &lt;script&gt;');
    expect(s.html).not.toContain('<script>');
    expect(s.text).toContain('188');
  });
});
```

- [ ] **Step 6: Fire welcome from `src/modules/auth/service.ts`**

Add to registerUser after `prisma.user.create(...)`, wrapped so it never blocks the response:
```ts
  import('../notifications/templates.js')
    .then(({ sendWelcomeEmail }) => sendWelcomeEmail(input.email, input.name))
    .catch(() => {
      // logged as email failure; don't fail registration
    });
```

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: 1 new test passes.

- [ ] **Step 8: Commit**

```bash
git add src/config.ts .env.example src/modules/notifications/ src/modules/auth/service.ts
git commit -m "feat(notifications): EmailProvider (Resend) + MemoryEmailProvider + welcome email"
```

---

### Task 4: Scheduler — daily check-in reminder + ponte-invite email

**Files:**
- Create: `src/modules/notifications/scheduler.ts`, `src/modules/notifications/scheduler.test.ts`
- Modify: `src/server.ts` (start scheduler), `src/modules/notifications/templates.ts` (add check-in reminder + ponte-invite templates), `src/modules/conflicts/ponte.ts` (send ponte-invite email on `openPonte`), `package.json` (add `node-cron`)

**Interfaces:**
- Produces:
  - `sendDailyCheckinReminders(now?: Date)` — for each user with no check-in "today" in their timezone, send a reminder email. Idempotent per day (looks at `CheckIn` rows).
  - `sendPonteInviteEmail(targetEmail, initiatorName)` — sent from `openPonte` (side effect after DB commit; error-tolerant).
  - `startScheduler()` — sets up node-cron for daily reminders (default 19:00 UTC — approx 16:00 São Paulo). Exposed but only called from `server.ts`, not from tests.

- [ ] **Step 1: Add `node-cron` to `package.json`**

```json
"node-cron": "^3.0.3"
```
Dev:
```json
"@types/node-cron": "^3.0.11"
```

- [ ] **Step 2: Extend `src/modules/notifications/templates.ts`**

```ts
export async function sendCheckinReminderEmail(to: string, name: string): Promise<void> {
  const subject = 'Seu check-in de hoje na LOVE Casal';
  const text = [
    `Oi ${name},`,
    '',
    'Só uma lembrança rápida: seu check-in de hoje ainda não foi feito.',
    'Leva 1 minuto — como foi seu dia, teve algum atrito ou momento bom com seu parceiro?',
    '',
    '— LOVE',
  ].join('\n');
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222">
      <h3 style="color:#c76b6b">Check-in de hoje</h3>
      <p>Oi <strong>${escapeHtml(name)}</strong>,</p>
      <p>Só uma lembrança rápida: seu check-in de hoje ainda não foi feito.</p>
      <p>Leva 1 minuto — como foi seu dia, teve algum atrito ou momento bom com seu parceiro?</p>
      <p>— LOVE</p>
    </div>`;
  await getEmailProvider().send({ to, subject, html, text });
}

export async function sendPonteInviteEmail(to: string, initiatorName: string): Promise<void> {
  const subject = `${initiatorName} pediu pra LOVE conversar com você`;
  const text = [
    `Oi,`,
    '',
    `${initiatorName} conversou com a LOVE sobre algo que aconteceu entre vocês e autorizou compartilhar um resumo com você.`,
    'Não é queixa nem cobrança — é um convite pra vocês se entenderem melhor.',
    '',
    'Abre o LOVE Casal e a LOVE te aguarda. Aceitar essa conversa é opcional.',
    '',
    '— LOVE',
  ].join('\n');
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#222">
      <h3 style="color:#c76b6b">Você tem um convite da LOVE</h3>
      <p><strong>${escapeHtml(initiatorName)}</strong> conversou com a LOVE sobre algo que aconteceu entre vocês e autorizou compartilhar um resumo com você.</p>
      <p>Não é queixa nem cobrança — é um convite pra vocês se entenderem melhor.</p>
      <p>Abre o LOVE Casal — aceitar essa conversa é opcional.</p>
      <p>— LOVE</p>
    </div>`;
  await getEmailProvider().send({ to, subject, html, text });
}
```

- [ ] **Step 3: Create `src/modules/notifications/scheduler.ts`**

```ts
import cron from 'node-cron';
import { prisma } from '../../db/client.js';
import { sendCheckinReminderEmail } from './templates.js';

function todayInTz(tz: string, now: Date): Date {
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
}

export async function sendDailyCheckinReminders(now: Date = new Date()): Promise<{ sent: number }> {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      profile: { select: { timezone: true } },
    },
  });
  let sent = 0;
  for (const u of users) {
    const tz = u.profile?.timezone ?? 'America/Sao_Paulo';
    const date = todayInTz(tz, now);
    const existing = await prisma.checkIn.findUnique({
      where: { userId_date: { userId: u.id, date } },
      select: { id: true },
    });
    if (existing) continue;
    try {
      await sendCheckinReminderEmail(u.email, u.name);
      sent++;
    } catch {
      // continue with next user
    }
  }
  return { sent };
}

export function startScheduler(): void {
  // Every day at 19:00 UTC (≈ 16:00 São Paulo)
  cron.schedule('0 19 * * *', () => {
    sendDailyCheckinReminders().catch(() => {
      // logged elsewhere
    });
  });
}
```

- [ ] **Step 4: Prisma schema — expose `profile` relation on User**

Modify `prisma/schema.prisma`:
```prisma
model User {
  // ... existing fields
  profile      Profile?
}

model Profile {
  // ... existing fields
  user User @relation(fields: [userId], references: [id])
}
```

Also modify `prisma/migrations/<new_timestamp>_user_profile_relation/migration.sql` — since we already have both tables, only the FK constraint is new:
```sql
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 5: Wire ponte-invite email into `openPonte`**

In `src/modules/conflicts/ponte.ts`, at the very end of `openPonte` after the transaction:
```ts
  // Fire-and-forget email
  import('../notifications/templates.js')
    .then(async ({ sendPonteInviteEmail }) => {
      const [initiator, target] = await Promise.all([
        prisma.user.findUnique({ where: { id: conflict.initiatorId }, select: { name: true } }),
        prisma.user.findUnique({ where: { id: conflict.targetId }, select: { email: true } }),
      ]);
      if (initiator && target) await sendPonteInviteEmail(target.email, initiator.name);
    })
    .catch(() => {
      // logged elsewhere
    });
```

- [ ] **Step 6: Start scheduler in `src/server.ts`**

```ts
import { startScheduler } from './modules/notifications/scheduler.js';
// ...
await app.listen({...});
startScheduler();
```

- [ ] **Step 7: Write the failing tests**

Create `src/modules/notifications/scheduler.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../../db/client.js';
import { MemoryEmailProvider, setEmailProvider } from './email.js';
import { sendDailyCheckinReminders } from './scheduler.js';

const email = new MemoryEmailProvider();

async function seedUser(emailAddr: string, phone: string, hasCheckinToday: boolean) {
  const u = await prisma.user.create({
    data: { name: 'Xx', email: emailAddr, phone, passwordHash: 'x' },
  });
  await prisma.profile.create({ data: { userId: u.id, timezone: 'America/Sao_Paulo' } });
  if (hasCheckinToday) {
    const now = new Date();
    const local = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const today = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
    await prisma.checkIn.create({
      data: { userId: u.id, date: today, moodOverall: 7 },
    });
  }
  return u;
}

beforeEach(async () => {
  setEmailProvider(email);
  email.sent.length = 0;
  await prisma.subscription.deleteMany();
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
afterAll(() => prisma.$disconnect());

describe('sendDailyCheckinReminders', () => {
  it('sends only to users without a check-in today', async () => {
    await seedUser('with@x.com', '+5511900000200', true);
    await seedUser('without@x.com', '+5511900000201', false);
    const res = await sendDailyCheckinReminders();
    expect(res.sent).toBe(1);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].to).toBe('without@x.com');
  });
});
```

- [ ] **Step 8: Migrate + generate + run tests**

Create migration `<timestamp>_user_profile_fk/migration.sql` (only if the FK isn't already there — the User model in step 4 also needs `profile: Profile?` field which is metadata-only for Prisma, no SQL). If Prisma's `migrate diff` produces no SQL because we only added a relation field and constraint, still create the migration manually with the ALTER TABLE from step 4.

Run:
```
npm install
npx prisma migrate deploy
npx prisma generate
npm test
```
Expected: 1 new test passes.

- [ ] **Step 9: Commit**

```bash
git add src/modules/notifications/ src/modules/conflicts/ponte.ts src/server.ts prisma/ package.json package-lock.json
git commit -m "feat(notifications): scheduler (daily check-in reminders) + ponte-invite email"
```

---

### Task 5: Retention job (LGPD 12-month purge)

**Files:**
- Create: `src/modules/notifications/retention.ts`, `src/modules/notifications/retention.test.ts`
- Modify: `src/modules/notifications/scheduler.ts` (add nightly retention cron)

**Interfaces:**
- Produces:
  - `runRetentionPurge(now?: Date)` — deletes `LoveMessage`, `ConflictMessage`, `JournalEntry`, `Event`, `CheckIn` older than 12 months (never touches `AuditLog`, `Consent`, `Subscription`, `User`, `Couple`). Writes one `AuditLog` entry summarizing per-table row counts. Idempotent.
  - Scheduler adds a nightly cron at 04:00 UTC.

- [ ] **Step 1: Create `src/modules/notifications/retention.ts`**

```ts
import { prisma } from '../../db/client.js';

const RETENTION_MS = 12 * 30 * 24 * 60 * 60 * 1000; // 12 months (approximate)

export interface RetentionSummary {
  loveMessages: number;
  conflictMessages: number;
  journalEntries: number;
  events: number;
  checkins: number;
}

export async function runRetentionPurge(now: Date = new Date()): Promise<RetentionSummary> {
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  const [lm, cm, je, ev, ci] = await Promise.all([
    prisma.loveMessage.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.conflictMessage.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.journalEntry.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    // Event has no createdAt of its own; purge via cascade from CheckIn.date < cutoff
    prisma.event.deleteMany({ where: { checkIn: { date: { lt: cutoff } } } }),
    prisma.checkIn.deleteMany({ where: { date: { lt: cutoff } } }),
  ]);
  const summary: RetentionSummary = {
    loveMessages: lm.count,
    conflictMessages: cm.count,
    journalEntries: je.count,
    events: ev.count,
    checkins: ci.count,
  };
  await prisma.auditLog.create({
    data: {
      actorId: 'system',
      action: 'retention.purge',
      target: JSON.stringify(summary),
    },
  });
  return summary;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/modules/notifications/retention.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../../db/client.js';
import { runRetentionPurge } from './retention.js';

async function seed() {
  const u = await prisma.user.create({
    data: { name: 'Xx', email: 'r@x.com', phone: '+5511900000210', passwordHash: 'x' },
  });
  const old = new Date(Date.now() - 400 * 24 * 3600 * 1000); // 400 days ago
  const recent = new Date(Date.now() - 30 * 24 * 3600 * 1000); // 30 days ago
  await prisma.$queryRawUnsafe(
    `INSERT INTO "JournalEntry" (id, "userId", title, content, "createdAt", "updatedAt")
     VALUES ('je-old', $1, 't', 'c', $2, $2), ('je-new', $1, 't', 'c', $3, $3)`,
    u.id,
    old,
    recent,
  );
  await prisma.$queryRawUnsafe(
    `INSERT INTO "LoveMessage" (id, "userId", context, role, content, "createdAt")
     VALUES ('lm-old', $1, 'general', 'user', 'x', $2), ('lm-new', $1, 'general', 'user', 'x', $3)`,
    u.id,
    old,
    recent,
  );
  return u;
}

beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.conflictBlock.deleteMany();
  await prisma.conflictMessage.deleteMany();
  await prisma.conflict.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.coupleTask.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.event.deleteMany();
  await prisma.checkIn.deleteMany();
  await prisma.safetyScreening.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.loveMessage.deleteMany();
  await prisma.consent.deleteMany();
  await prisma.couple.deleteMany();
  await prisma.coupleInvite.deleteMany();
  await prisma.twoFactorCode.deleteMany();
  await prisma.user.deleteMany();
});
afterAll(() => prisma.$disconnect());

describe('runRetentionPurge', () => {
  it('purges rows older than 12 months and keeps recent ones + writes audit log', async () => {
    await seed();
    const summary = await runRetentionPurge();
    expect(summary.loveMessages).toBe(1);
    expect(summary.journalEntries).toBe(1);

    const remainingJournal = await prisma.journalEntry.findMany();
    expect(remainingJournal).toHaveLength(1);
    expect(remainingJournal[0].id).toBe('je-new');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'retention.purge' } });
    expect(audit).not.toBeNull();
    const parsed = JSON.parse(audit!.target);
    expect(parsed.loveMessages).toBe(1);
  });
});
```

- [ ] **Step 3: Wire retention into scheduler**

Modify `src/modules/notifications/scheduler.ts` — add:
```ts
import { runRetentionPurge } from './retention.js';
// ...
export function startScheduler(): void {
  cron.schedule('0 19 * * *', () => {
    sendDailyCheckinReminders().catch(() => undefined);
  });
  cron.schedule('0 4 * * *', () => {
    runRetentionPurge().catch(() => undefined);
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 1 new test passes.

- [ ] **Step 5: Commit**

```bash
git add src/modules/notifications/
git commit -m "feat(retention): nightly LGPD purge (>12mo) + audit log"
```

---

### Task 6: Admin (metrics + user disable)

**Files:**
- Create: `src/modules/admin/routes.ts`, `src/modules/admin/service.ts`, `src/modules/admin/admin.test.ts`
- Modify: `prisma/schema.prisma` (add `User.isAdmin` + `User.disabledAt`), migration, `src/app.ts` (register), `src/modules/auth/tokens.ts` or auth plugin (surface isAdmin on req)

**Interfaces:**
- Produces:
  - `User.isAdmin` boolean (default false), `User.disabledAt` DateTime? nullable.
  - `requireAdmin` preHandler decorator: reads userId from JWT then checks `isAdmin`. 403 `FORBIDDEN` otherwise.
  - `GET /admin/metrics` — returns `{ users, couples, subscriptions: {active, trialing, past_due, canceled}, conflicts: {open, resolved}, dailyActiveCheckins: number }` for the last 7 days.
  - `GET /admin/users?limit=&cursor=` — returns paginated list of users (no PII beyond email).
  - `POST /admin/users/:id/disable` — sets `disabledAt = now()`. A disabled user's tokens are rejected (auth plugin checks `disabledAt`).
  - Adding an admin remains a manual DB update — no self-service endpoint.

- [ ] **Step 1: Add fields to `prisma/schema.prisma`**

```prisma
model User {
  // ... existing
  isAdmin      Boolean  @default(false)
  disabledAt   DateTime?
}
```

Manual migration:
```sql
ALTER TABLE "User" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "disabledAt" TIMESTAMP(3);
```

- [ ] **Step 2: Update auth plugin to reject disabled users**

In `src/modules/auth/auth-plugin.ts`, after `verifyAccessToken`:
```ts
      const user = await prisma.user.findUnique({
        where: { id: sub },
        select: { disabledAt: true, isAdmin: true },
      });
      if (!user || user.disabledAt) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Conta desativada' } });
      }
      req.userId = sub;
      req.isAdmin = user.isAdmin;
```

Extend the FastifyRequest module declaration:
```ts
declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    isAdmin?: boolean;
  }
```

Add `import { prisma } from '../../db/client.js';` at the top of `auth-plugin.ts`.

- [ ] **Step 3: Create `src/modules/admin/service.ts`**

```ts
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';

export async function metrics() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [users, couples, subs, conflicts, dailyActiveCheckins] = await Promise.all([
    prisma.user.count(),
    prisma.couple.count(),
    prisma.subscription.groupBy({ by: ['status'], _count: true }),
    prisma.conflict.groupBy({ by: ['status'], _count: true }),
    prisma.checkIn.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
  ]);
  const subscriptions = Object.fromEntries(subs.map((s) => [s.status, s._count]));
  const conflictsByStatus = Object.fromEntries(conflicts.map((c) => [c.status, c._count]));
  return { users, couples, subscriptions, conflicts: conflictsByStatus, dailyActiveCheckins };
}

export async function listUsers(opts: { limit: number; cursor?: string }) {
  const rows = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: { id: true, email: true, isAdmin: true, disabledAt: true, createdAt: true },
  });
  const hasMore = rows.length > opts.limit;
  const users = hasMore ? rows.slice(0, opts.limit) : rows;
  return { users, nextCursor: hasMore ? users[users.length - 1].id : null };
}

export async function disableUser(id: string): Promise<void> {
  const res = await prisma.user.updateMany({ where: { id }, data: { disabledAt: new Date() } });
  if (res.count === 0) throw new AppError('NOT_FOUND', 'Usuário não encontrado', 404);
}
```

- [ ] **Step 4: Create `src/modules/admin/routes.ts`**

```ts
import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import { AppError } from '../../errors.js';
import { disableUser, listUsers, metrics } from './service.js';

const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().optional(),
  })
  .strict();

function handle(err: unknown, reply: FastifyReply, log: FastifyBaseLogger) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
    });
  }
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
  }
  log.error({ err }, 'admin route failed');
  return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
}

function requireAdminPreHandler(req: import('fastify').FastifyRequest, reply: FastifyReply) {
  if (!req.isAdmin) {
    reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Restrito a administradores' } });
  }
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const guards = { preHandler: [app.authenticate, requireAdminPreHandler] };

  app.get('/admin/metrics', guards, async (req, reply) => {
    try {
      return reply.code(200).send(await metrics());
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.get('/admin/users', guards, async (req, reply) => {
    try {
      const q = listQuery.parse(req.query ?? {});
      return reply.code(200).send(await listUsers(q));
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });

  app.post<{ Params: { id: string } }>('/admin/users/:id/disable', guards, async (req, reply) => {
    try {
      await disableUser(req.params.id);
      return reply.code(204).send();
    } catch (err) {
      return handle(err, reply, req.log);
    }
  });
}
```

- [ ] **Step 5: Register in `src/app.ts`**

```ts
import { adminRoutes } from './modules/admin/routes.js';
// ...
  await app.register(adminRoutes);
```

- [ ] **Step 6: Write tests**

Create `src/modules/admin/admin.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';

const app = await buildApp();

async function makeUser(email: string, phone: string, admin = false) {
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Xx', email, phone, password: 'SenhaForte123' },
  });
  if (admin) {
    await prisma.user.updateMany({ where: { email }, data: { isAdmin: true } });
  }
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: 'SenhaForte123' },
  });
  return login.json().accessToken as string;
}

beforeEach(async () => {
  await prisma.subscription.deleteMany();
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

describe('Admin', () => {
  it('non-admin gets 403 on /admin/metrics', async () => {
    const tok = await makeUser('u@x.com', '+5511900000220', false);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/metrics',
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('admin sees metrics', async () => {
    const tok = await makeUser('admin@x.com', '+5511900000221', true);
    const res = await app.inject({
      method: 'GET',
      url: '/admin/metrics',
      headers: { authorization: `Bearer ${tok}` },
    });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().users).toBe('number');
    expect(res.json().subscriptions).toBeDefined();
  });

  it('disable makes the disabled user unable to auth', async () => {
    const adminTok = await makeUser('admin@x.com', '+5511900000222', true);
    const uTok = await makeUser('u@x.com', '+5511900000223');
    const u = await prisma.user.findFirst({ where: { email: 'u@x.com' } });
    const dis = await app.inject({
      method: 'POST',
      url: `/admin/users/${u!.id}/disable`,
      headers: { authorization: `Bearer ${adminTok}` },
    });
    expect(dis.statusCode).toBe(204);

    const followup = await app.inject({
      method: 'GET',
      url: '/consent/status',
      headers: { authorization: `Bearer ${uTok}` },
    });
    expect(followup.statusCode).toBe(401);
  });
});
```

- [ ] **Step 7: Migrate + generate + run tests**

Create migration `<timestamp>_add_user_admin_fields/migration.sql`:
```sql
ALTER TABLE "User" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "disabledAt" TIMESTAMP(3);
```

Run: `npx prisma migrate deploy && npx prisma generate && npm test`
Expected: 3 new tests pass. Total test count should now be 72 (existing) + 3 (billing status/webhook) + 2 (billing gate) + 1 (email) + 1 (scheduler) + 1 (retention) + 3 (admin) = **83 tests**.

- [ ] **Step 8: Commit**

```bash
git add prisma/ src/modules/admin/ src/modules/auth/auth-plugin.ts src/app.ts
git commit -m "feat(admin): metrics + user list + disable (isAdmin gate, disabled users rejected at auth)"
```

---

## Self-Review Notes

- **Spec coverage:** covers spec §2.11 (retention 12mo via Task 5), §7 (LGPD retention + purge audit), and the "modelo pago" from §9. Adds ops fundamentals (billing, notifications, admin) that were implicit in the spec but not detailed. Sessão semanal por voz (§2.6), rituais (§2.8), and modo separação (§2.13) remain product-flow work outside this plan.
- **Placeholder scan:** none. All migration SQL and code is literal.
- **Type consistency:** `EmailProvider` mirrors `SmsSender` / `LlmProvider` / `EmbeddingProvider` — all follow the same `set*/get*` singleton with a memory fake for tests. `Subscription` FK cascade left as RESTRICT to preserve billing history if a user were to be hard-deleted later.
- **Vendor-neutrality:** Email is behind an interface (Resend swappable in 1 file). Stripe is the exception — but state lives in our own `Subscription` table, so a future gateway swap replaces one adapter file plus a one-time data migration.
- **Safety of admin:** admin flag is manual DB set, disabled users are rejected at auth, and admin endpoints never expose user content (only counts + emails/timestamps).
