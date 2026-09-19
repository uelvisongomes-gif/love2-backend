-- CreateTable
CREATE TABLE "Agreement" (
    "id" TEXT NOT NULL,
    "coupleId" TEXT,
    "createdBy" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pillar" TEXT,
    "status" TEXT NOT NULL DEFAULT 'em_andamento',
    "conflictId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agreement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Agreement_coupleId_createdAt_idx" ON "Agreement"("coupleId", "createdAt");

-- CreateIndex
CREATE INDEX "Agreement_createdBy_createdAt_idx" ON "Agreement"("createdBy", "createdAt");
