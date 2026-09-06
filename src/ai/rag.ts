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
  const literal = toVectorLiteral(vector);
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO "Source" (id, pillar, title, url, content, embedding, "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5::vector, now())
     RETURNING id`,
    input.pillar,
    input.title,
    input.url,
    input.content,
    literal,
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
  // Force sequential scan for accurate results (ivfflat with default probes
  // returns too few rows on small datasets). Wrap in a transaction so the SET
  // LOCAL applies to the following query.
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL enable_indexscan = off`);
    await tx.$executeRawUnsafe(`SET LOCAL enable_bitmapscan = off`);
    return opts.pillar
      ? tx.$queryRawUnsafe<(SourceRow & { distance: number })[]>(
          `SELECT id, pillar, title, url, content, "createdAt",
                  (embedding <=> $1::vector) AS distance
           FROM "Source"
           WHERE pillar = $2 AND embedding IS NOT NULL
           ORDER BY embedding <=> $1::vector
           LIMIT $3`,
          literal,
          opts.pillar,
          k,
        )
      : tx.$queryRawUnsafe<(SourceRow & { distance: number })[]>(
          `SELECT id, pillar, title, url, content, "createdAt",
                  (embedding <=> $1::vector) AS distance
           FROM "Source"
           WHERE embedding IS NOT NULL
           ORDER BY embedding <=> $1::vector
           LIMIT $2`,
          literal,
          k,
        );
  });
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
