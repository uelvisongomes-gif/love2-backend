import { describe, it, expect } from 'vitest';
import { MemoryEmbeddingProvider } from './embeddings.js';

describe('MemoryEmbeddingProvider', () => {
  it('returns embeddings with the expected dimensions', async () => {
    const p = new MemoryEmbeddingProvider(1024);
    const [v] = await p.embed(['comunicação sadia no casal']);
    expect(v).toHaveLength(1024);
    expect(v.every((n) => Number.isFinite(n))).toBe(true);
  });

  it('gives identical texts identical embeddings', async () => {
    const p = new MemoryEmbeddingProvider(1024);
    const [a, b] = await p.embed(['x', 'x']);
    expect(a).toEqual(b);
  });

  it('gives different texts different embeddings', async () => {
    const p = new MemoryEmbeddingProvider(1024);
    const [a, b] = await p.embed(['x', 'y']);
    expect(a).not.toEqual(b);
  });
});
