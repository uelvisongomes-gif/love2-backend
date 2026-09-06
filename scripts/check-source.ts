import 'dotenv/config';
import { prisma } from '../src/db/client.js';

interface Row { column_name: string; udt_name: string }

const rows = await prisma.$queryRawUnsafe<Row[]>(
  `SELECT column_name, udt_name FROM information_schema.columns WHERE table_name='Source' ORDER BY ordinal_position`,
);
console.log('Source columns:');
rows.forEach((r) => console.log('  ' + r.column_name + ' :: ' + r.udt_name));
await prisma.$disconnect();
