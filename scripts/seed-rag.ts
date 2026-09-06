import 'dotenv/config';
import { prisma } from '../src/db/client.js';
import { getEmbeddingProvider } from '../src/ai/embeddings.js';
import { STARTER_SOURCES } from '../src/ai/rag-seed-content.js';

function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

async function main(): Promise<void> {
  // Which sources are new?
  const existingUrls = new Set<string>();
  const rows = await prisma.$queryRawUnsafe<{ url: string }[]>(`SELECT url FROM "Source"`);
  for (const r of rows) existingUrls.add(r.url);

  const pending = STARTER_SOURCES.filter((s) => !existingUrls.has(s.url));
  const skipped = STARTER_SOURCES.length - pending.length;
  if (pending.length === 0) {
    console.log(`seed-rag: inserted=0, skipped=${skipped}, total=${STARTER_SOURCES.length}`);
    await prisma.$disconnect();
    return;
  }

  console.log(`seed-rag: embedding ${pending.length} sources in ONE batch request...`);
  const vectors = await getEmbeddingProvider().embed(pending.map((s) => s.content));

  let inserted = 0;
  for (let i = 0; i < pending.length; i++) {
    const s = pending[i];
    const literal = toVectorLiteral(vectors[i]);
    await prisma.$queryRawUnsafe(
      `INSERT INTO "Source" (id, pillar, title, url, content, embedding, "createdAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5::vector, now())`,
      s.pillar,
      s.title,
      s.url,
      s.content,
      literal,
    );
    inserted++;
    console.log(`  + ${s.pillar}/${s.title}`);
  }

  console.log(`seed-rag: inserted=${inserted}, skipped=${skipped}, total=${STARTER_SOURCES.length}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
