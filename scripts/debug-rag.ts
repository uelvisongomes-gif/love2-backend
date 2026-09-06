import 'dotenv/config';
import { prisma } from '../src/db/client.js';
import { searchRag } from '../src/ai/rag.js';

const count = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
  `SELECT COUNT(*)::bigint as c FROM "Source" WHERE embedding IS NOT NULL`,
);
console.log('Sources with embedding:', Number(count[0].c));

const hits = await searchRag('brigamos por dinheiro no casamento', { k: 3 });
console.log('\nHits for "brigamos por dinheiro no casamento":');
for (const h of hits) {
  console.log(`  ${h.similarity.toFixed(3)} | ${h.source.pillar} | ${h.source.title}`);
}

await prisma.$disconnect();
