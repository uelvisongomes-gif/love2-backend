CREATE TABLE "FinanceItem" (
    "id" TEXT NOT NULL,
    "coupleId" TEXT,
    "createdBy" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(12,2),
    "category" TEXT,
    "dueBy" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "responsibleId" TEXT,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FinanceItem_coupleId_kind_idx" ON "FinanceItem"("coupleId", "kind");
CREATE INDEX "FinanceItem_createdBy_kind_idx" ON "FinanceItem"("createdBy", "kind");
CREATE INDEX "FinanceItem_dueBy_idx" ON "FinanceItem"("dueBy");
