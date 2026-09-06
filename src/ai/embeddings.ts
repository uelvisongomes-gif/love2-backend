import crypto from 'node:crypto';
import { loadConfig } from '../config.js';

export interface EmbeddingProvider {
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export class MemoryEmbeddingProvider implements EmbeddingProvider {
  constructor(public readonly dimensions: number = 1024) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vectorFor(t));
  }

  private vectorFor(text: string): number[] {
    const out: number[] = new Array(this.dimensions);
    const seed = crypto.createHash('sha256').update(text).digest();
    for (let i = 0; i < this.dimensions; i++) {
      const byte = seed[i % seed.length];
      const mixed = (byte * 31 + i) & 0xff;
      out[i] = mixed / 127.5 - 1;
    }
    return out;
  }
}

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  private endpoint = 'https://api.voyageai.com/v1/embeddings';
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    public readonly dimensions: number,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
        input_type: 'document',
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Voyage embeddings failed (${res.status}): ${body}`);
    }
    const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  private endpoint = 'https://api.openai.com/v1/embeddings';
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    public readonly dimensions: number,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
        dimensions: this.dimensions,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI embeddings failed (${res.status}): ${body}`);
    }
    const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

let instance: EmbeddingProvider | null = null;

export function setEmbeddingProvider(p: EmbeddingProvider): void {
  instance = p;
}

export function getEmbeddingProvider(): EmbeddingProvider {
  if (instance) return instance;
  const cfg = loadConfig();
  if (cfg.EMBEDDING_PROVIDER === 'voyage') {
    if (!cfg.VOYAGE_API_KEY) throw new Error('VOYAGE_API_KEY is required when EMBEDDING_PROVIDER=voyage');
    instance = new VoyageEmbeddingProvider(cfg.VOYAGE_API_KEY, cfg.EMBEDDING_MODEL, cfg.EMBEDDING_DIMENSIONS);
  } else if (cfg.EMBEDDING_PROVIDER === 'openai') {
    if (!cfg.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai');
    instance = new OpenAiEmbeddingProvider(cfg.OPENAI_API_KEY, cfg.EMBEDDING_MODEL, cfg.EMBEDDING_DIMENSIONS);
  } else {
    instance = new MemoryEmbeddingProvider(cfg.EMBEDDING_DIMENSIONS);
  }
  return instance;
}
