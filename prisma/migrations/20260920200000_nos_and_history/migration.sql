-- History PIN
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "historyPinHash" TEXT;

-- Couple Narrative
CREATE TABLE IF NOT EXISTS "CoupleNarrative" (
  "id" TEXT NOT NULL,
  "coupleId" TEXT NOT NULL,
  "ourVision" TEXT,
  "ourHistory" TEXT,
  "ourValues" TEXT,
  "connectionRituals" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CoupleNarrative_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CoupleNarrative_coupleId_key" ON "CoupleNarrative"("coupleId");

-- Partner Perception
CREATE TABLE IF NOT EXISTS "PartnerPerception" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "admiration" TEXT,
  "gratitude" TEXT,
  "worries" TEXT,
  "hopes" TEXT,
  "visibleToPartner" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerPerception_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PartnerPerception_userId_key" ON "PartnerPerception"("userId");

-- Personal Challenge
CREATE TABLE IF NOT EXISTS "PersonalChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "visibleToPartner" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonalChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PersonalChallenge_userId_createdAt_idx" ON "PersonalChallenge"("userId", "createdAt");

-- History Entry
CREATE TABLE IF NOT EXISTS "HistoryEntry" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "category" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HistoryEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "HistoryEntry_userId_createdAt_idx" ON "HistoryEntry"("userId", "createdAt");

-- PIN attempts
CREATE TABLE IF NOT EXISTS "HistoryPinAttempt" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL,
  "ip" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoryPinAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "HistoryPinAttempt_userId_createdAt_idx" ON "HistoryPinAttempt"("userId", "createdAt");
