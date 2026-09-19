CREATE TABLE "LifeItem" (
    "id" TEXT NOT NULL,
    "coupleId" TEXT,
    "createdBy" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "responsibleId" TEXT,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LifeItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LifeItem_coupleId_domain_idx" ON "LifeItem"("coupleId", "domain");
CREATE INDEX "LifeItem_createdBy_domain_idx" ON "LifeItem"("createdBy", "domain");
CREATE INDEX "LifeItem_scheduledAt_idx" ON "LifeItem"("scheduledAt");
