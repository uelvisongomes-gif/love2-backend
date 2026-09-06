-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "pillar" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Source_url_key" ON "Source"("url");

-- CreateIndex
CREATE INDEX "Source_pillar_idx" ON "Source"("pillar");

-- pgvector column (Prisma has no native type; managed via raw SQL)
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "Source" ADD COLUMN "embedding" vector(1024);
CREATE INDEX "Source_embedding_idx" ON "Source" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
