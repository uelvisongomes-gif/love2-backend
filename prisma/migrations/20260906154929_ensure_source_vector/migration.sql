-- Idempotent: guarantees the pgvector column and index on Source exist,
-- even if a previous drift/reset removed them. Prisma has no native pgvector
-- type, so this raw SQL is our only source of truth for the column.
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "Source" ADD COLUMN IF NOT EXISTS "embedding" vector(1024);
CREATE INDEX IF NOT EXISTS "Source_embedding_idx" ON "Source" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
