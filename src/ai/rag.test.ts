import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../db/client.js';
import { ingestSource, searchRag, formatCitation } from './rag.js';
import { MemoryEmbeddingProvider, setEmbeddingProvider } from './embeddings.js';

setEmbeddingProvider(new MemoryEmbeddingProvider(1024));

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
