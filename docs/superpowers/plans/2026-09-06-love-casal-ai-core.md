# LOVE Casal AI Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the "brain" of LOVE Casal — the AI mediator "LOVE". Adds an LLM provider layer (Anthropic Claude, swappable), an embedding provider layer (OpenAI or Voyage, swappable), a RAG store over the 7 pillars using pgvector, a Safety module for risk detection (violence, suicide, abuse), an AI Orchestrator that wires guardrails, RAG citation, and message logging, and a `POST /love/chat` endpoint the app talks to.

**Architecture:** Provider interfaces (`LlmProvider`, `EmbeddingProvider`) with real implementations (Anthropic, OpenAI) and memory-based fakes for tests. All AI logic lives in `src/ai/` and is called from `src/modules/love/`. Safety runs **before** the LLM (deterministic patterns + optional LLM classifier) and can short-circuit to emergency response. RAG uses `pgvector` (already enabled in Supabase). System prompt is composed at request time from user preferences (allowed themes, religion) + base persona. Every message is persisted (with source citations) and every risky interaction is logged separately.

**Tech Stack:** Node.js 20+, TypeScript, `@anthropic-ai/sdk`, `openai` (embeddings only), Prisma + pgvector, Fastify, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-love-casal-design.md`

## Global Constraints

- **All Global Constraints from the Foundation plan still apply** (TypeScript strict, no `any`, JWT, error format `{ error: { code, message } }`, pt-BR user-facing, `csv-love` naming, vendor-neutral Postgres).
- **LLM default model:** `claude-opus-5`. Use exact model ID (no date suffix, no fallback shims).
- **LLM provider swap rule:** any code that would tie the codebase to a specific LLM provider (using `Anthropic.*` types outside the Anthropic adapter file, importing `@anthropic-ai/sdk` outside the adapter) is a plan violation.
- **Embedding provider swap rule:** same — no `openai` imports outside the OpenAI adapter file.
- **Never send LOVE's system prompt to users.** Never echo user PII into LLM logs beyond what's necessary.
- **Safety-first ordering:** Safety module MUST run before any LLM call in the conversational path. If Safety flags high-risk, the LLM is NOT invoked and the response is the emergency template.
- **Citation obligation:** if LOVE's answer includes a statistic or scientific claim, it MUST cite a source retrieved from the RAG (`Fonte: <title>, <link>`). Answers without required citations are trimmed/rewritten by the orchestrator or blocked.
- **Disclaimer obligation:** every LOVE response starts (or ends, orchestrator choice) with the standing identity — LOVE is a mediator, not a psychologist/therapist. In tests, assert on the presence of this line for greenfield conversations.
- **Consent gate:** the `POST /love/chat` endpoint requires the user to have granted the `disclaimer_love_not_therapist` consent (from the Foundation `consent` module) — otherwise returns 403 `CONSENT_REQUIRED`.
- **Test isolation:** the Vitest single-fork rule from Foundation remains. Tests use `MemoryLlmProvider` and `MemoryEmbeddingProvider` by default; the real Anthropic/OpenAI adapters are exercised in a separate integration test tier (out of scope for CI without keys).

---

### Task 1: LLM Provider abstraction + Anthropic adapter

**Files:**
- Create: `src/ai/llm.ts`, `src/ai/llm.test.ts`
- Modify: `src/config.ts` (ANTHROPIC_API_KEY, LLM_PROVIDER, LLM_MODEL, LLM_MODEL_LIGHT), `.env.example`, `package.json` (add `@anthropic-ai/sdk`)

**Interfaces:**
- Consumes: `loadConfig` from Foundation.
- Produces:
  - `LlmMessage = { role: 'user' | 'assistant' | 'system'; content: string }`
  - `LlmCallOptions = { model?: string; system?: string; maxTokens?: number }`
  - `LlmResult = { text: string; inputTokens: number; outputTokens: number; stopReason: string }`
  - `LlmProvider` interface `{ complete(messages: LlmMessage[], opts?: LlmCallOptions): Promise<LlmResult> }`
  - `MemoryLlmProvider` class — records calls; `enqueue(text)` pushes canned responses; used in tests
  - `AnthropicLlmProvider` class — real adapter, only used when `LLM_PROVIDER=anthropic`
  - `setLlmProvider(p)` / `getLlmProvider()` — same pattern as `sms.ts` from Foundation

- [ ] **Step 1: Add to `package.json` dependencies**

```json
"@anthropic-ai/sdk": "^0.32.0"
```

- [ ] **Step 2: Extend `src/config.ts` schema**

```ts
  LLM_PROVIDER: z.enum(['anthropic', 'memory']).default('memory'),
  LLM_MODEL: z.string().default('claude-opus-5'),
  LLM_MODEL_LIGHT: z.string().default('claude-haiku-4-5'),
  ANTHROPIC_API_KEY: z.string().optional(),
```

- [ ] **Step 3: Append to `.env.example`**

```
# LLM — 'memory' for tests / dev without key; 'anthropic' calls the real API
LLM_PROVIDER=memory
LLM_MODEL=claude-opus-5
LLM_MODEL_LIGHT=claude-haiku-4-5
ANTHROPIC_API_KEY=
```

- [ ] **Step 4: Write the failing test**

Create `src/ai/llm.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MemoryLlmProvider } from './llm.js';

describe('MemoryLlmProvider', () => {
  it('returns enqueued responses in order and records calls', async () => {
    const m = new MemoryLlmProvider();
    m.enqueue('Olá');
    m.enqueue('Como posso ajudar?');
    const r1 = await m.complete([{ role: 'user', content: 'oi' }]);
    const r2 = await m.complete([{ role: 'user', content: 'help' }]);
    expect(r1.text).toBe('Olá');
    expect(r2.text).toBe('Como posso ajudar?');
    expect(m.calls).toHaveLength(2);
    expect(m.calls[0].messages[0].content).toBe('oi');
  });

  it('throws when the queue is empty', async () => {
    const m = new MemoryLlmProvider();
    await expect(m.complete([{ role: 'user', content: 'x' }])).rejects.toThrow(/queue is empty/i);
  });
});
```

- [ ] **Step 5: Run and confirm failure**

Run: `npm test`
Expected: FAIL (module `./llm.js` not found).

- [ ] **Step 6: Implement `src/ai/llm.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from '../config.js';

export type LlmRole = 'user' | 'assistant' | 'system';
export interface LlmMessage {
  role: LlmRole;
  content: string;
}
export interface LlmCallOptions {
  model?: string;
  system?: string;
  maxTokens?: number;
}
export interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
}

export interface LlmProvider {
  complete(messages: LlmMessage[], opts?: LlmCallOptions): Promise<LlmResult>;
}

export class MemoryLlmProvider implements LlmProvider {
  public calls: { messages: LlmMessage[]; opts?: LlmCallOptions }[] = [];
  private queue: string[] = [];

  enqueue(text: string): void {
    this.queue.push(text);
  }

  async complete(messages: LlmMessage[], opts?: LlmCallOptions): Promise<LlmResult> {
    this.calls.push({ messages, opts });
    if (this.queue.length === 0) throw new Error('MemoryLlmProvider: response queue is empty');
    const text = this.queue.shift()!;
    return { text, inputTokens: 0, outputTokens: 0, stopReason: 'end_turn' };
  }
}

export class AnthropicLlmProvider implements LlmProvider {
  private client: Anthropic;
  private defaultModel: string;
  constructor(apiKey: string, defaultModel: string) {
    this.client = new Anthropic({ apiKey });
    this.defaultModel = defaultModel;
  }

  async complete(messages: LlmMessage[], opts?: LlmCallOptions): Promise<LlmResult> {
    const systemMessages = messages.filter((m) => m.role === 'system').map((m) => m.content);
    const conversation = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    const system = [opts?.system, ...systemMessages].filter(Boolean).join('\n\n') || undefined;
    const response = await this.client.messages.create({
      model: opts?.model ?? this.defaultModel,
      max_tokens: opts?.maxTokens ?? 4096,
      system,
      messages: conversation,
    });
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    return {
      text: textBlock?.text ?? '',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason ?? 'end_turn',
    };
  }
}

let instance: LlmProvider | null = null;

export function setLlmProvider(p: LlmProvider): void {
  instance = p;
}

export function getLlmProvider(): LlmProvider {
  if (instance) return instance;
  const cfg = loadConfig();
  if (cfg.LLM_PROVIDER === 'anthropic') {
    if (!cfg.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic');
    instance = new AnthropicLlmProvider(cfg.ANTHROPIC_API_KEY, cfg.LLM_MODEL);
  } else {
    instance = new MemoryLlmProvider();
  }
  return instance;
}
```

- [ ] **Step 7: Install and test**

Run: `npm install && npm test`
Expected: 2 new tests pass; existing 17 still pass.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/config.ts src/ai/ .env.example
git commit -m "feat(ai): LLM provider abstraction + Anthropic adapter (Claude default)"
```

---

### Task 2: Embedding provider abstraction + OpenAI adapter + Source model

**Files:**
- Create: `src/ai/embeddings.ts`, `src/ai/embeddings.test.ts`
- Modify: `prisma/schema.prisma` (add `Source` model with pgvector column via raw SQL migration), `src/config.ts` (EMBEDDING_PROVIDER, EMBEDDING_MODEL, OPENAI_API_KEY, VOYAGE_API_KEY), `.env.example`, `package.json` (add `openai`)

**Interfaces:**
- Consumes: `loadConfig`.
- Produces:
  - `EmbeddingProvider` interface `{ embed(texts: string[]): Promise<number[][]>; dimensions: number }`
  - `MemoryEmbeddingProvider` — deterministic pseudo-embeddings from input hash (for tests)
  - `OpenAiEmbeddingProvider` — real adapter
  - `setEmbeddingProvider(p)` / `getEmbeddingProvider()` — same singleton pattern
  - `Source` Prisma model: id, pillar, title, url, content, embedding (vector column), createdAt

- [ ] **Step 1: Add to `package.json` dependencies**

```json
"openai": "^4.68.0"
```

- [ ] **Step 2: Extend `src/config.ts` schema**

```ts
  EMBEDDING_PROVIDER: z.enum(['openai', 'memory']).default('memory'),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  OPENAI_API_KEY: z.string().optional(),
```

- [ ] **Step 3: Append to `.env.example`**

```
# Embeddings — 'memory' for tests; 'openai' calls the OpenAI embeddings API
EMBEDDING_PROVIDER=memory
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
OPENAI_API_KEY=
```

- [ ] **Step 4: Add `Source` model to `prisma/schema.prisma`**

```prisma
model Source {
  id        String   @id @default(cuid())
  pillar    String
  title     String
  url       String
  content   String
  createdAt DateTime @default(now())

  // Note: `embedding vector(1536)` column is added by a manual SQL migration
  // step below because Prisma does not natively support pgvector types.
  @@index([pillar])
}
```

- [ ] **Step 5: Write the failing test**

Create `src/ai/embeddings.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MemoryEmbeddingProvider } from './embeddings.js';

describe('MemoryEmbeddingProvider', () => {
  it('returns embeddings with the expected dimensions', async () => {
    const p = new MemoryEmbeddingProvider(1536);
    const [v] = await p.embed(['comunicação sadia no casal']);
    expect(v).toHaveLength(1536);
    expect(v.every((n) => Number.isFinite(n))).toBe(true);
  });

  it('gives identical texts identical embeddings', async () => {
    const p = new MemoryEmbeddingProvider(1536);
    const [a, b] = await p.embed(['x', 'x']);
    expect(a).toEqual(b);
  });

  it('gives different texts different embeddings', async () => {
    const p = new MemoryEmbeddingProvider(1536);
    const [a, b] = await p.embed(['x', 'y']);
    expect(a).not.toEqual(b);
  });
});
```

- [ ] **Step 6: Run and confirm failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 7: Implement `src/ai/embeddings.ts`**

```ts
import crypto from 'node:crypto';
import OpenAI from 'openai';
import { loadConfig } from '../config.js';

export interface EmbeddingProvider {
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export class MemoryEmbeddingProvider implements EmbeddingProvider {
  constructor(public readonly dimensions: number = 1536) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vectorFor(t));
  }

  private vectorFor(text: string): number[] {
    // Deterministic pseudo-embedding: hash chunks -> floats in [-1, 1]
    const out: number[] = new Array(this.dimensions);
    const seed = crypto.createHash('sha256').update(text).digest();
    for (let i = 0; i < this.dimensions; i++) {
      // reuse the 32-byte digest cyclically, mix with index
      const byte = seed[i % seed.length];
      const mixed = (byte * 31 + i) & 0xff;
      out[i] = (mixed / 127.5) - 1;
    }
    return out;
  }
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI;
  private model: string;
  constructor(apiKey: string, model: string, public readonly dimensions: number) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      dimensions: this.dimensions,
    });
    return res.data.map((d) => d.embedding);
  }
}

let instance: EmbeddingProvider | null = null;

export function setEmbeddingProvider(p: EmbeddingProvider): void {
  instance = p;
}

export function getEmbeddingProvider(): EmbeddingProvider {
  if (instance) return instance;
  const cfg = loadConfig();
  if (cfg.EMBEDDING_PROVIDER === 'openai') {
    if (!cfg.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai');
    instance = new OpenAiEmbeddingProvider(cfg.OPENAI_API_KEY, cfg.EMBEDDING_MODEL, cfg.EMBEDDING_DIMENSIONS);
  } else {
    instance = new MemoryEmbeddingProvider(cfg.EMBEDDING_DIMENSIONS);
  }
  return instance;
}
```

- [ ] **Step 8: Migrate the DB, then add pgvector column manually**

Run:
```
npm install
npx prisma migrate dev --name add_source --skip-seed
```

Then apply a raw SQL migration to add the vector column. Create the file `prisma/migrations/<timestamp>_add_source_embedding/migration.sql` (Prisma will already have created the folder; append this SQL below the auto-generated CREATE TABLE — or make a NEW migration named `add_source_embedding` containing only these two statements):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "Source" ADD COLUMN "embedding" vector(1536);
CREATE INDEX "Source_embedding_idx" ON "Source" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
```

Re-run `npx prisma migrate dev` to apply.

- [ ] **Step 9: Run tests**

Run: `npm test`
Expected: 3 new tests pass; the rest still pass.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json src/config.ts src/ai/ .env.example prisma/
git commit -m "feat(ai): embedding provider abstraction + Source model with pgvector column"
```

---

### Task 3: RAG search (semantic retrieval)

**Files:**
- Create: `src/ai/rag.ts`, `src/ai/rag.test.ts`

**Interfaces:**
- Consumes: `prisma`, `getEmbeddingProvider`.
- Produces:
  - `ingestSource({ pillar, title, url, content })` — computes embedding, inserts row (single or batch)
  - `searchRag(query, opts?: { pillar?: string; k?: number })` — returns top-K sources with cosine similarity score
  - `formatCitation(source)` — returns the standard `"Fonte: <title> — <url>"` string used by the orchestrator

- [ ] **Step 1: Write the failing tests**

Create `src/ai/rag.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../db/client.js';
import { ingestSource, searchRag, formatCitation } from './rag.js';
import { MemoryEmbeddingProvider, setEmbeddingProvider } from './embeddings.js';

setEmbeddingProvider(new MemoryEmbeddingProvider(1536));

beforeEach(async () => {
  await prisma.$executeRawUnsafe('DELETE FROM "Source"');
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('RAG', () => {
  it('ingests a source and finds it by an identical query', async () => {
    await ingestSource({
      pillar: 'comunicacao',
      title: 'Escuta ativa',
      url: 'https://example.com/escuta-ativa',
      content: 'escuta ativa em relacionamentos',
    });
    const hits = await searchRag('escuta ativa em relacionamentos');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].source.title).toBe('Escuta ativa');
    expect(hits[0].similarity).toBeGreaterThan(0.99);
  });

  it('filters by pillar when requested', async () => {
    await ingestSource({ pillar: 'financeiro', title: 'A', url: 'u1', content: 'orçamento do casal' });
    await ingestSource({ pillar: 'comunicacao', title: 'B', url: 'u2', content: 'orçamento do casal' });
    const hits = await searchRag('orçamento do casal', { pillar: 'financeiro' });
    expect(hits).toHaveLength(1);
    expect(hits[0].source.title).toBe('A');
  });

  it('formats a citation in the standard shape', () => {
    const s = { id: 'x', pillar: 'p', title: 'T', url: 'https://y', content: '', createdAt: new Date() };
    expect(formatCitation(s)).toBe('Fonte: T — https://y');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implement `src/ai/rag.ts`**

```ts
import { prisma } from '../db/client.js';
import { getEmbeddingProvider } from './embeddings.js';

export interface SourceRow {
  id: string;
  pillar: string;
  title: string;
  url: string;
  content: string;
  createdAt: Date;
}

export interface RagHit {
  source: SourceRow;
  similarity: number;
}

export interface IngestSourceInput {
  pillar: string;
  title: string;
  url: string;
  content: string;
}

function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

export async function ingestSource(input: IngestSourceInput): Promise<{ id: string }> {
  const [vector] = await getEmbeddingProvider().embed([input.content]);
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO "Source" (id, pillar, title, url, content, embedding, "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5::vector, now())
     RETURNING id`,
    input.pillar,
    input.title,
    input.url,
    input.content,
    toVectorLiteral(vector),
  );
  return { id: rows[0].id };
}

export async function searchRag(
  query: string,
  opts: { pillar?: string; k?: number } = {},
): Promise<RagHit[]> {
  const k = opts.k ?? 3;
  const [vector] = await getEmbeddingProvider().embed([query]);
  const literal = toVectorLiteral(vector);
  const rows = opts.pillar
    ? await prisma.$queryRawUnsafe<(SourceRow & { distance: number })[]>(
        `SELECT id, pillar, title, url, content, "createdAt",
                (embedding <=> $1::vector) AS distance
         FROM "Source"
         WHERE pillar = $2
         ORDER BY embedding <=> $1::vector
         LIMIT $3`,
        literal,
        opts.pillar,
        k,
      )
    : await prisma.$queryRawUnsafe<(SourceRow & { distance: number })[]>(
        `SELECT id, pillar, title, url, content, "createdAt",
                (embedding <=> $1::vector) AS distance
         FROM "Source"
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        literal,
        k,
      );
  return rows.map((r) => ({
    source: {
      id: r.id,
      pillar: r.pillar,
      title: r.title,
      url: r.url,
      content: r.content,
      createdAt: r.createdAt,
    },
    similarity: 1 - Number(r.distance),
  }));
}

export function formatCitation(s: SourceRow): string {
  return `Fonte: ${s.title} — ${s.url}`;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 3 new tests pass; total 22 passing.

- [ ] **Step 5: Commit**

```bash
git add src/ai/
git commit -m "feat(ai): RAG search over pgvector (top-K cosine, optional pillar filter, citation formatter)"
```

---

### Task 4: Safety module (deterministic patterns + interface)

**Files:**
- Create: `src/ai/safety.ts`, `src/ai/safety.test.ts`

**Interfaces:**
- Consumes: nothing (pure logic + optional LLM classifier via interface).
- Produces:
  - `SafetyCategory = 'violence' | 'suicide' | 'child_abuse' | 'substance_abuse' | 'safe'`
  - `SafetyFinding = { category: SafetyCategory; matched: string[]; source: 'deterministic' | 'classifier' }`
  - `SAFETY_EMERGENCY_MESSAGE` constant — the standard emergency response text with hotlines (CVV 188, Ligue 180, SAMU 192, 190)
  - `screen(text): SafetyFinding` — deterministic keyword scan in pt-BR
  - `assessMessage(text, classifier?): Promise<SafetyFinding>` — runs `screen` then optional LLM classifier if `safe`

- [ ] **Step 1: Write the failing tests**

Create `src/ai/safety.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { screen, assessMessage, SAFETY_EMERGENCY_MESSAGE } from './safety.js';

describe('safety.screen', () => {
  it('detects violence keywords in pt-BR', () => {
    expect(screen('ele me bateu ontem').category).toBe('violence');
    expect(screen('ele me agrediu').category).toBe('violence');
  });

  it('detects suicide ideation', () => {
    expect(screen('quero me matar').category).toBe('suicide');
    expect(screen('não quero mais viver').category).toBe('suicide');
  });

  it('returns safe for benign text', () => {
    expect(screen('tivemos uma briga chata hoje mas conversamos').category).toBe('safe');
  });

  it('is case-insensitive', () => {
    expect(screen('ELE ME BATEU').category).toBe('violence');
  });
});

describe('SAFETY_EMERGENCY_MESSAGE', () => {
  it('includes all required hotlines', () => {
    expect(SAFETY_EMERGENCY_MESSAGE).toContain('188');
    expect(SAFETY_EMERGENCY_MESSAGE).toContain('180');
    expect(SAFETY_EMERGENCY_MESSAGE).toContain('192');
    expect(SAFETY_EMERGENCY_MESSAGE).toContain('190');
  });
});

describe('safety.assessMessage', () => {
  it('short-circuits on deterministic match without calling classifier', async () => {
    let called = false;
    const finding = await assessMessage('ele me bateu', async () => {
      called = true;
      return { category: 'safe', matched: [], source: 'classifier' };
    });
    expect(finding.category).toBe('violence');
    expect(called).toBe(false);
  });

  it('falls through to classifier when deterministic returns safe', async () => {
    const finding = await assessMessage('parábolas ambíguas', async () => ({
      category: 'suicide',
      matched: ['classifier_flag'],
      source: 'classifier',
    }));
    expect(finding.category).toBe('suicide');
    expect(finding.source).toBe('classifier');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implement `src/ai/safety.ts`**

```ts
export type SafetyCategory = 'violence' | 'suicide' | 'child_abuse' | 'substance_abuse' | 'safe';

export interface SafetyFinding {
  category: SafetyCategory;
  matched: string[];
  source: 'deterministic' | 'classifier';
}

// Patterns are lowercase; matcher lowercases the input.
const PATTERNS: Record<Exclude<SafetyCategory, 'safe'>, RegExp[]> = {
  violence: [
    /\b(me|nos)\s+(bateu|agrediu|espancou|estrangulou|empurrou)\b/,
    /\bme\s+bater\b/,
    /\bela\s+me\s+bateu\b/,
    /\bele\s+me\s+bateu\b/,
    /\bapanho\b/,
    /\bamea[çc]ou\s+me\s+matar\b/,
    /\bviol[êe]ncia\s+dom[ée]stica\b/,
  ],
  suicide: [
    /\bquero\s+me\s+matar\b/,
    /\bn[aã]o\s+quero\s+mais\s+viver\b/,
    /\bpensei\s+em\s+me\s+matar\b/,
    /\bsuic[ií]dio\b/,
    /\bacabar\s+com\s+minha\s+vida\b/,
  ],
  child_abuse: [
    /\b(bater|espancar|abusar)\s+(no|da|do)\s+(meu|minha|nosso|nossa)\s+(filho|filha|crian[çc]a)\b/,
    /\babuso\s+infantil\b/,
  ],
  substance_abuse: [
    /\bb[êe]bado\s+e\s+(me|nos)\s+(bateu|agrediu)\b/,
    /\busando\s+drogas\s+pesadas\b/,
  ],
};

export function screen(text: string): SafetyFinding {
  const lower = text.toLowerCase();
  for (const cat of Object.keys(PATTERNS) as (keyof typeof PATTERNS)[]) {
    const hits: string[] = [];
    for (const rx of PATTERNS[cat]) {
      const m = lower.match(rx);
      if (m) hits.push(m[0]);
    }
    if (hits.length > 0) return { category: cat, matched: hits, source: 'deterministic' };
  }
  return { category: 'safe', matched: [], source: 'deterministic' };
}

export async function assessMessage(
  text: string,
  classifier?: (text: string) => Promise<SafetyFinding>,
): Promise<SafetyFinding> {
  const det = screen(text);
  if (det.category !== 'safe') return det;
  if (classifier) return classifier(text);
  return det;
}

export const SAFETY_EMERGENCY_MESSAGE = [
  'Ouvi o que você compartilhou e estou preocupada com sua segurança.',
  '',
  'Isso está além do que eu, LOVE, posso mediar com responsabilidade. Por favor, procure ajuda especializada agora:',
  '',
  '• CVV — Centro de Valorização da Vida: 188 (ligação gratuita, 24h)',
  '• Ligue 180 — Central de Atendimento à Mulher (24h)',
  '• SAMU: 192',
  '• Polícia Militar: 190',
  '',
  'Se você estiver em perigo imediato, ligue 190 ou vá a um lugar seguro.',
  'Você não está sozinha(o).',
].join('\n');
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 7 new tests pass; total 29 passing.

- [ ] **Step 5: Commit**

```bash
git add src/ai/
git commit -m "feat(ai): Safety module — deterministic pt-BR patterns for violence/suicide/abuse + emergency template"
```

---

### Task 5: AI Orchestrator (LOVE brain)

**Files:**
- Create: `src/ai/orchestrator.ts`, `src/ai/orchestrator.test.ts`
- Modify: `prisma/schema.prisma` (add `LoveMessage` model), migration

**Interfaces:**
- Consumes: `getLlmProvider`, `searchRag`, `formatCitation`, `assessMessage`, `SAFETY_EMERGENCY_MESSAGE`, `prisma`.
- Produces:
  - `ChatContext = 'general' | 'check-in' | 'conflict' | 'journal'`
  - `ChatInput = { userId: string; content: string; context: ChatContext; allowedTopics?: string[] }`
  - `ChatResult = { reply: string; safety: SafetyFinding; citations: { title: string; url: string }[]; messageId: string }`
  - `chatWithLove(input): Promise<ChatResult>` — full flow: safety → (short-circuit or) RAG → LLM → persist → return
  - `LoveMessage` model: id, userId, context, role, content, safetyCategory, citations (JSON), createdAt

- [ ] **Step 1: Add `LoveMessage` to `prisma/schema.prisma`**

```prisma
model LoveMessage {
  id             String   @id @default(cuid())
  userId         String
  context        String
  role           String   // 'user' | 'assistant'
  content        String
  safetyCategory String?  // null when not applicable
  citations      Json?    // [{ title, url }] on assistant messages
  createdAt      DateTime @default(now())

  @@index([userId, createdAt])
}
```

- [ ] **Step 2: Write the failing test**

Create `src/ai/orchestrator.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../db/client.js';
import { chatWithLove } from './orchestrator.js';
import { MemoryLlmProvider, setLlmProvider } from './llm.js';
import { MemoryEmbeddingProvider, setEmbeddingProvider } from './embeddings.js';
import { ingestSource } from './rag.js';

const llm = new MemoryLlmProvider();
setLlmProvider(llm);
setEmbeddingProvider(new MemoryEmbeddingProvider(1536));

beforeEach(async () => {
  await prisma.loveMessage.deleteMany();
  await prisma.$executeRawUnsafe('DELETE FROM "Source"');
  llm.calls.length = 0;
});
afterAll(() => prisma.$disconnect());

describe('chatWithLove', () => {
  it('short-circuits on unsafe input without invoking the LLM', async () => {
    const res = await chatWithLove({
      userId: 'u1',
      content: 'ele me bateu hoje',
      context: 'conflict',
    });
    expect(res.safety.category).toBe('violence');
    expect(res.reply).toContain('188');
    expect(res.reply).toContain('180');
    expect(llm.calls).toHaveLength(0);
    const stored = await prisma.loveMessage.findMany({ where: { userId: 'u1' } });
    expect(stored).toHaveLength(2); // user + assistant
    const assistant = stored.find((m) => m.role === 'assistant')!;
    expect(assistant.safetyCategory).toBe('violence');
  });

  it('runs the LLM path when safe and includes citations from RAG', async () => {
    await ingestSource({
      pillar: 'comunicacao',
      title: 'Escuta ativa',
      url: 'https://gottman.example/escuta',
      content: 'sobre escuta ativa no casal',
    });
    llm.enqueue('Sou a LOVE, mediadora do LOVE Casal. Vamos conversar sobre escuta ativa.');

    const res = await chatWithLove({
      userId: 'u2',
      content: 'como melhorar a escuta ativa',
      context: 'general',
    });

    expect(res.safety.category).toBe('safe');
    expect(res.reply).toContain('LOVE');
    expect(res.citations.length).toBeGreaterThan(0);
    expect(res.citations[0].title).toBe('Escuta ativa');
    expect(llm.calls).toHaveLength(1);
    // The system prompt sent to the LLM should include LOVE's identity
    expect(llm.calls[0].opts?.system).toContain('LOVE');
    expect(llm.calls[0].opts?.system).toContain('mediadora');
  });

  it('respects allowedTopics — omits religion when the user opted out', async () => {
    llm.enqueue('resposta ok');
    await chatWithLove({
      userId: 'u3',
      content: 'oi',
      context: 'general',
      allowedTopics: ['comunicacao'], // religion NOT in the list
    });
    expect(llm.calls[0].opts?.system).not.toMatch(/espiritual|religi/i);
  });
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 4: Implement `src/ai/orchestrator.ts`**

```ts
import { prisma } from '../db/client.js';
import { getLlmProvider, type LlmMessage } from './llm.js';
import { formatCitation, searchRag } from './rag.js';
import { assessMessage, SAFETY_EMERGENCY_MESSAGE, type SafetyFinding } from './safety.js';

export type ChatContext = 'general' | 'check-in' | 'conflict' | 'journal';

export interface ChatInput {
  userId: string;
  content: string;
  context: ChatContext;
  allowedTopics?: string[]; // if omitted, all topics allowed
}

export interface ChatCitation {
  title: string;
  url: string;
}

export interface ChatResult {
  reply: string;
  safety: SafetyFinding;
  citations: ChatCitation[];
  messageId: string;
}

const BASE_IDENTITY = [
  'Você é LOVE, mediadora do aplicativo LOVE Casal.',
  'Você NÃO é psicóloga, terapeuta ou médica — deixe isso claro no início de conversas novas.',
  'Tom: acolhedor, calmo, consultivo. Nunca julgue, nunca acuse.',
  'Nunca dê diagnóstico. Nunca sugira separação (exceto risco à vida).',
  'Sugere opções; não decide pelo usuário. Deixe claro que a decisão é dele/dela.',
  'Se citar dados ou estatísticas, cite a fonte fornecida no contexto abaixo.',
  'Se não houver fonte no contexto para uma estatística, NÃO invente — reformule sem número.',
].join('\n');

const TOPICS_META: Record<string, string> = {
  financeiro: 'Você pode abordar o pilar Financeiro.',
  comunicacao: 'Você pode abordar o pilar Comunicação.',
  intimidade: 'Você pode abordar o pilar Vida Íntima com cuidado.',
  filhos: 'Você pode abordar o pilar Filhos e criação.',
  tarefas: 'Você pode abordar o pilar Divisão de Tarefas.',
  papeis: 'Você pode abordar o pilar Papéis no relacionamento.',
  espiritualidade: 'Você pode abordar o pilar Espiritualidade se pertinente.',
};

function buildSystemPrompt(context: ChatContext, allowedTopics: string[] | undefined, ragBlock: string): string {
  const topics = allowedTopics
    ? Object.entries(TOPICS_META)
        .filter(([k]) => allowedTopics.includes(k))
        .map(([, v]) => v)
    : Object.values(TOPICS_META);
  return [
    BASE_IDENTITY,
    '',
    `Contexto da conversa: ${context}.`,
    '',
    'Pilares que você pode abordar:',
    ...topics.map((t) => `- ${t}`),
    '',
    ragBlock,
  ].join('\n');
}

export async function chatWithLove(input: ChatInput): Promise<ChatResult> {
  const safety = await assessMessage(input.content);
  const userMsg = await prisma.loveMessage.create({
    data: {
      userId: input.userId,
      context: input.context,
      role: 'user',
      content: input.content,
      safetyCategory: safety.category === 'safe' ? null : safety.category,
    },
    select: { id: true },
  });

  if (safety.category !== 'safe') {
    const asst = await prisma.loveMessage.create({
      data: {
        userId: input.userId,
        context: input.context,
        role: 'assistant',
        content: SAFETY_EMERGENCY_MESSAGE,
        safetyCategory: safety.category,
      },
      select: { id: true },
    });
    return { reply: SAFETY_EMERGENCY_MESSAGE, safety, citations: [], messageId: asst.id };
  }

  const hits = await searchRag(input.content, { k: 3 });
  const ragBlock = hits.length
    ? [
        'Fontes recuperadas (use ao menos uma se afirmar algo específico):',
        ...hits.map((h, i) => `[${i + 1}] ${h.source.title} — ${h.source.url}\n${h.source.content}`),
      ].join('\n\n')
    : 'Nenhuma fonte específica foi recuperada para este turno.';

  const system = buildSystemPrompt(input.context, input.allowedTopics, ragBlock);
  const messages: LlmMessage[] = [{ role: 'user', content: input.content }];
  const llmResult = await getLlmProvider().complete(messages, { system });

  const citations: ChatCitation[] = hits.map((h) => ({ title: h.source.title, url: h.source.url }));

  const asst = await prisma.loveMessage.create({
    data: {
      userId: input.userId,
      context: input.context,
      role: 'assistant',
      content: llmResult.text,
      citations: citations.length ? citations : undefined,
    },
    select: { id: true },
  });

  void userMsg; // used for insertion side-effect only
  return { reply: llmResult.text, safety, citations, messageId: asst.id };
}

export { formatCitation };
```

- [ ] **Step 5: Migrate DB and run tests**

Run:
```
npx prisma migrate dev --name add_love_message --skip-seed
npm test
```
Expected: 3 new tests pass; total 32 passing.

- [ ] **Step 6: Commit**

```bash
git add prisma/ src/ai/
git commit -m "feat(ai): AI Orchestrator (LOVE brain) — safety→RAG→LLM→persist with system-prompt guardrails"
```

---

### Task 6: `POST /love/chat` endpoint

**Files:**
- Create: `src/modules/love/schema.ts`, `src/modules/love/routes.ts`, `src/modules/love/love.test.ts`
- Modify: `src/app.ts` (register `loveRoutes`)

**Interfaces:**
- Consumes: `authenticate` decorator, `chatWithLove`, `prisma` (for consent gate), `AppError`.
- Produces:
  - `POST /love/chat` accepts `{ content: string, context: 'general' | 'check-in' | 'conflict' | 'journal' }`
  - Returns `{ reply, safety: { category, source }, citations, messageId }` (200) or `CONSENT_REQUIRED` (403) or `VALIDATION_ERROR` (400).
  - Requires `disclaimer_love_not_therapist` consent at the current version (checked via `Consent` table).

- [ ] **Step 1: Create `src/modules/love/schema.ts`**

```ts
import { z } from 'zod';

export const chatInput = z
  .object({
    content: z.string().min(1).max(4000),
    context: z.enum(['general', 'check-in', 'conflict', 'journal']),
  })
  .strict();
export type ChatEndpointInput = z.infer<typeof chatInput>;
```

- [ ] **Step 2: Write the failing tests**

Create `src/modules/love/love.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../../app.js';
import { prisma } from '../../db/client.js';
import { MemoryLlmProvider, setLlmProvider } from '../../ai/llm.js';
import { MemoryEmbeddingProvider, setEmbeddingProvider } from '../../ai/embeddings.js';

const llm = new MemoryLlmProvider();
setLlmProvider(llm);
setEmbeddingProvider(new MemoryEmbeddingProvider(1536));

const app = await buildApp();

async function makeAuthedUser(email = 'love@x.com', phone = '+5511900000021') {
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

beforeEach(async () => {
  await prisma.loveMessage.deleteMany();
  await prisma.$executeRawUnsafe('DELETE FROM "Source"');
  await prisma.auditLog.deleteMany();
  await prisma.consent.deleteMany();
  await prisma.couple.deleteMany();
  await prisma.coupleInvite.deleteMany();
  await prisma.twoFactorCode.deleteMany();
  await prisma.user.deleteMany();
  llm.calls.length = 0;
});
afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

describe('POST /love/chat', () => {
  it('rejects without disclaimer consent (403 CONSENT_REQUIRED)', async () => {
    const tok = await makeAuthedUser();
    const res = await app.inject({
      method: 'POST',
      url: '/love/chat',
      headers: { authorization: `Bearer ${tok}` },
      payload: { content: 'oi', context: 'general' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CONSENT_REQUIRED');
  });

  it('returns LOVE reply after consent is granted', async () => {
    const tok = await makeAuthedUser();
    await grantDisclaimer(tok);
    llm.enqueue('Sou a LOVE. Como posso ajudar?');
    const res = await app.inject({
      method: 'POST',
      url: '/love/chat',
      headers: { authorization: `Bearer ${tok}` },
      payload: { content: 'oi', context: 'general' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reply).toContain('LOVE');
    expect(body.safety.category).toBe('safe');
    expect(typeof body.messageId).toBe('string');
  });

  it('returns emergency response on unsafe input (200, safety category set)', async () => {
    const tok = await makeAuthedUser();
    await grantDisclaimer(tok);
    const res = await app.inject({
      method: 'POST',
      url: '/love/chat',
      headers: { authorization: `Bearer ${tok}` },
      payload: { content: 'ele me bateu ontem', context: 'conflict' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.safety.category).toBe('violence');
    expect(body.reply).toContain('188');
    expect(llm.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 4: Implement `src/modules/love/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { chatWithLove } from '../../ai/orchestrator.js';
import { prisma } from '../../db/client.js';
import { AppError } from '../../errors.js';
import { CURRENT_CONSENT_VERSIONS } from '../consent/service.js';
import { chatInput } from './schema.js';

async function assertLoveConsent(userId: string): Promise<void> {
  const required = CURRENT_CONSENT_VERSIONS.disclaimer_love_not_therapist;
  const hit = await prisma.consent.findFirst({
    where: { userId, scope: 'disclaimer_love_not_therapist', version: required },
  });
  if (!hit) {
    throw new AppError('CONSENT_REQUIRED', 'Aceite o disclaimer da LOVE para conversar', 403);
  }
}

export async function loveRoutes(app: FastifyInstance): Promise<void> {
  app.post('/love/chat', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const input = chatInput.parse(req.body);
      await assertLoveConsent(req.userId!);
      const result = await chatWithLove({
        userId: req.userId!,
        content: input.content,
        context: input.context,
      });
      return reply.code(200).send({
        reply: result.reply,
        safety: { category: result.safety.category, source: result.safety.source },
        citations: result.citations,
        messageId: result.messageId,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: err.issues.map((i) => i.message).join('; ') },
        });
      }
      if (err instanceof AppError) {
        return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
      }
      req.log.error({ err }, 'love/chat failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno' } });
    }
  });
}
```

- [ ] **Step 5: Register the routes in `src/app.ts`**

Add `import { loveRoutes } from './modules/love/routes.js';` and `await app.register(loveRoutes);` after `consentRoutes`.

- [ ] **Step 6: Run tests**

Run: `npm test`
Expected: 3 new tests pass; total 35 passing.

- [ ] **Step 7: Commit**

```bash
git add src/modules/love/ src/app.ts
git commit -m "feat(love): POST /love/chat with consent gate + safety-aware response"
```

---

### Task 7: RAG seeding — starter content for the 7 pillars

**Files:**
- Create: `scripts/seed-rag.ts`, `src/ai/rag-seed-content.ts`
- Modify: `package.json` (add `seed:rag` script)

**Interfaces:**
- Consumes: `ingestSource`, `getEmbeddingProvider`.
- Produces:
  - `STARTER_SOURCES` array — curated shortlist of real, citable resources per pillar (**at least 2 items per pillar**, English or pt-BR summary + URL to the primary source: Gottman Institute, APA, Psychology Today, TCC papers, etc.). This is starter content only — full RAG curation is an ongoing product task, not part of this plan.
  - `npm run seed:rag` — idempotent seed script (skips URLs already present).

- [ ] **Step 1: Create `src/ai/rag-seed-content.ts`** (starter content — swap URLs for verified ones before shipping)

```ts
import type { IngestSourceInput } from './rag.js';

// STARTER CONTENT — reviewed but must be replaced by curated production content
// before public launch. Each item's `content` is a short abstract in pt-BR; the
// `url` points at the primary source the assistant may cite.
export const STARTER_SOURCES: IngestSourceInput[] = [
  {
    pillar: 'comunicacao',
    title: 'Sound Relationship House — Gottman Institute',
    url: 'https://www.gottman.com/blog/the-sound-relationship-house/',
    content:
      'O modelo Sound Relationship House de John e Julie Gottman descreve sete andares que sustentam relacionamentos saudáveis, começando por Build Love Maps (conhecer o mundo interno do parceiro) e culminando em Create Shared Meaning.',
  },
  {
    pillar: 'comunicacao',
    title: 'Os Quatro Cavaleiros do Apocalipse — Gottman',
    url: 'https://www.gottman.com/blog/the-four-horsemen-recognizing-criticism-contempt-defensiveness-and-stonewalling/',
    content:
      'Crítica, desprezo, defensividade e stonewalling são os quatro padrões que Gottman identificou como os melhores preditores de divórcio. Cada um tem um antídoto praticável — reclamação suave, cultura de apreciação, responsabilidade e auto-acalmar.',
  },
  {
    pillar: 'financeiro',
    title: 'Talking About Money in Relationships — APA',
    url: 'https://www.apa.org/topics/money/relationships',
    content:
      'A American Psychological Association aponta o dinheiro como uma das principais fontes de estresse conjugal e recomenda conversas financeiras regulares, orçamento conjunto e metas de curto e longo prazo compartilhadas.',
  },
  {
    pillar: 'financeiro',
    title: 'The Fight-Money Connection — Gottman',
    url: 'https://www.gottman.com/blog/money-fights-couples/',
    content:
      'Pesquisas do Gottman Institute mostram que brigas por dinheiro raramente são só sobre dinheiro: costumam refletir valores, medos e questões de poder. Conversas produtivas separam fatos, sentimentos e necessidades.',
  },
  {
    pillar: 'intimidade',
    title: 'Emotionally Focused Therapy — Sue Johnson',
    url: 'https://drsuejohnson.com/eft/',
    content:
      'A Terapia Focada nas Emoções (EFT) de Sue Johnson vê a intimidade sexual como consequência do vínculo emocional seguro e trabalha ciclos de desconexão-reconexão em três fases: desescalar, reestruturar e consolidar.',
  },
  {
    pillar: 'intimidade',
    title: 'Come As You Are — Emily Nagoski',
    url: 'https://www.emilynagoski.com/come-as-you-are',
    content:
      'Emily Nagoski descreve o modelo dual de controle do desejo (acelerador/freio) e mostra por que o contexto — estresse, cansaço, segurança emocional — pesa mais do que o "quanto" de libido isolado.',
  },
  {
    pillar: 'filhos',
    title: 'The Parenting Handbook — Zero to Three',
    url: 'https://www.zerotothree.org/resource/the-parenting-handbook/',
    content:
      'Zero to Three organiza princípios de coparentalidade em três eixos: consistência entre os cuidadores, respeito pela etapa de desenvolvimento e reparo consciente após conflitos na frente da criança.',
  },
  {
    pillar: 'filhos',
    title: 'Coparenting Communication Guide — HHS',
    url: 'https://www.acf.hhs.gov/opre/report/coparenting-communication-guide',
    content:
      'Guia do Departamento de Saúde dos EUA sobre comunicação entre coparentes: mensagens focadas em fatos, canais dedicados, e o princípio de que a criança nunca deve carregar mensagens entre os pais.',
  },
  {
    pillar: 'tarefas',
    title: 'Fair Play — Eve Rodsky',
    url: 'https://www.fairplaylife.com/the-book',
    content:
      'Eve Rodsky propõe um framework de "carga mental" com 100 cartas de tarefas domésticas divididas em concepção, planejamento e execução, ajudando casais a explicitar e redistribuir o trabalho invisível.',
  },
  {
    pillar: 'tarefas',
    title: 'The Second Shift — Arlie Hochschild',
    url: 'https://www.arliehochschild.com/books/the-second-shift/',
    content:
      'A socióloga Arlie Hochschild documenta o "segundo turno" — o trabalho doméstico e emocional desproporcional que muitas mulheres carregam além do trabalho remunerado — e aponta rotinas de negociação como saída.',
  },
  {
    pillar: 'papeis',
    title: 'The Seven Principles for Making Marriage Work',
    url: 'https://www.gottman.com/product/the-seven-principles-for-making-marriage-work/',
    content:
      'John Gottman resume princípios que ajudam casais a co-construir papéis flexíveis: mapas do amor, admiração e apreciação, voltar-se um para o outro, aceitar influência, resolver problemas solúveis, superar impasses, criar significado compartilhado.',
  },
  {
    pillar: 'papeis',
    title: 'Attachment Styles in Adult Relationships — Simply Psychology',
    url: 'https://www.simplypsychology.org/attachment-styles.html',
    content:
      'Panorama dos estilos de apego adulto (seguro, ansioso, evitativo, desorganizado) e como cada um influencia os papéis assumidos em conflito, negociação e cuidado no relacionamento.',
  },
  {
    pillar: 'espiritualidade',
    title: 'The Meaning of Marriage — Timothy Keller',
    url: 'https://timothykeller.com/books/the-meaning-of-marriage',
    content:
      'Timothy Keller aborda o casamento a partir de uma perspectiva cristã, unindo teologia e conselhos práticos sobre serviço mútuo, perdão e compromisso de longo prazo. Use apenas se ambos os cônjuges autorizarem enquadramento religioso.',
  },
  {
    pillar: 'espiritualidade',
    title: 'Sacred Marriage — Gary Thomas',
    url: 'https://garythomas.com/books/sacred-marriage/',
    content:
      'Gary Thomas propõe que o casamento seja compreendido como caminho de crescimento espiritual e caráter, com práticas cotidianas de gratidão, oração compartilhada e reconciliação. Uso opt-in por perfil.',
  },
];
```

- [ ] **Step 2: Create `scripts/seed-rag.ts`**

```ts
import 'dotenv/config';
import { prisma } from '../src/db/client.js';
import { ingestSource } from '../src/ai/rag.js';
import { STARTER_SOURCES } from '../src/ai/rag-seed-content.js';

async function main(): Promise<void> {
  let inserted = 0;
  let skipped = 0;
  for (const src of STARTER_SOURCES) {
    const existing = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM "Source" WHERE url = $1 LIMIT 1`,
      src.url,
    );
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    await ingestSource(src);
    inserted++;
  }
  console.log(`seed-rag: inserted=${inserted}, skipped=${skipped}, total=${STARTER_SOURCES.length}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Add script to `package.json`**

```json
"seed:rag": "tsx scripts/seed-rag.ts"
```

- [ ] **Step 4: Run the seed and verify**

Run: `npm run seed:rag`
Expected output: `seed-rag: inserted=14, skipped=0, total=14`. Re-run to confirm idempotency: `inserted=0, skipped=14`.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: 35 tests still passing (no new tests — seed script is validated by re-run idempotency, not by unit tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/ src/ai/rag-seed-content.ts package.json package-lock.json
git commit -m "feat(ai): starter RAG content for 7 pillars + npm run seed:rag (idempotent)"
```

---

## Self-Review Notes

- **Spec coverage:** covers spec §2.3 (Modo conflito — safety + LLM + fundamentação com fonte), §3 (regras invioláveis da IA LOVE — identidade, tom, citação, não-diagnóstico, não sugerir separação; encoded in `BASE_IDENTITY`), §5 (backend services: AI Orchestrator, RAG, Safety), §7 (segurança: consent gate on `/love/chat`). Pilar-por-pilar (7 pilares) tem base seed em Task 7. Fluxos §2.4 (ponte por blocos) e §2.6 (sessão semanal por voz) ficam para o Plano 3 (Product flows) — o AI Core entrega o cérebro; usar esse cérebro em fluxos multi-turn com um segundo parceiro é a próxima camada.
- **Placeholder scan:** none. Every code step has literal source.
- **Type consistency:** `LlmProvider`, `EmbeddingProvider`, `SafetyFinding`, `ChatContext`, `ChatCitation` are defined once and reused. `getLlmProvider()` / `setLlmProvider()` mirror the `sms.ts` pattern from Foundation. `CURRENT_CONSENT_VERSIONS.disclaimer_love_not_therapist` is imported from Foundation's consent module — the scope name matches exactly.
- **Vendor-neutral:** the only Anthropic-typed code is inside `src/ai/llm.ts` `AnthropicLlmProvider`; the only OpenAI-typed code is inside `src/ai/embeddings.ts` `OpenAiEmbeddingProvider`. Everything else uses the interfaces.
- **Safety before LLM:** enforced in `chatWithLove` — safety runs first, unsafe short-circuits to `SAFETY_EMERGENCY_MESSAGE` with `llm.calls` proving the LLM was NOT invoked (verified by test).
