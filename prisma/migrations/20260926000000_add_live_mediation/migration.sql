CREATE TABLE IF NOT EXISTS "LiveMediation" (
  "id" TEXT NOT NULL,
  "coupleId" TEXT NOT NULL,
  "initiatorId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'waiting_partner',
  "topic" TEXT,
  "agreementId" TEXT,
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiveMediation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LiveMediation_coupleId_createdAt_idx" ON "LiveMediation"("coupleId", "createdAt");

CREATE TABLE IF NOT EXISTS "LiveMediationMessage" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "senderId" TEXT,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiveMediationMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LiveMediationMessage_sessionId_createdAt_idx" ON "LiveMediationMessage"("sessionId", "createdAt");
