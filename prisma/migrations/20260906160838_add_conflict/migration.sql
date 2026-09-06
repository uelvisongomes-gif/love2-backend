CREATE TABLE "Conflict" (
    "id" TEXT NOT NULL,
    "coupleId" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "pillar" TEXT,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conflict_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Conflict_coupleId_createdAt_idx" ON "Conflict"("coupleId", "createdAt");
CREATE INDEX "Conflict_initiatorId_idx" ON "Conflict"("initiatorId");
CREATE INDEX "Conflict_targetId_idx" ON "Conflict"("targetId");

CREATE TABLE "ConflictMessage" (
    "id" TEXT NOT NULL,
    "conflictId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConflictMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConflictMessage_conflictId_createdAt_idx" ON "ConflictMessage"("conflictId", "createdAt");

CREATE TABLE "ConflictBlock" (
    "id" TEXT NOT NULL,
    "conflictId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConflictBlock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConflictBlock_conflictId_order_idx" ON "ConflictBlock"("conflictId", "order");
