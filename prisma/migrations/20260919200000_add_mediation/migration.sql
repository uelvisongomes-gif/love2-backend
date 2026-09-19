CREATE TABLE "MediationSession" (
    "id" TEXT NOT NULL,
    "coupleId" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "topic" TEXT,
    "synthesis" TEXT,
    "proposedAgreement" TEXT,
    "agreementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediationSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MediationSession_coupleId_createdAt_idx" ON "MediationSession"("coupleId", "createdAt");
CREATE INDEX "MediationSession_initiatorId_idx" ON "MediationSession"("initiatorId");
CREATE INDEX "MediationSession_targetId_idx" ON "MediationSession"("targetId");

CREATE TABLE "MediationStep" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediationStep_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MediationStep_sessionId_userId_step_key" ON "MediationStep"("sessionId", "userId", "step");
CREATE INDEX "MediationStep_sessionId_idx" ON "MediationStep"("sessionId");
