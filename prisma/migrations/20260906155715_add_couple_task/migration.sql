CREATE TABLE "CoupleTask" (
    "id" TEXT NOT NULL,
    "coupleId" TEXT NOT NULL,
    "pillar" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueBy" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "completedByA" BOOLEAN NOT NULL DEFAULT false,
    "completedByB" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoupleTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CoupleTask_coupleId_createdAt_idx" ON "CoupleTask"("coupleId", "createdAt");
