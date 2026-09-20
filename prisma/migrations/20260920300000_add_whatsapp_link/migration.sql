-- UserPhoneLink
CREATE TABLE IF NOT EXISTS "UserPhoneLink" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "phoneE164" TEXT NOT NULL,
  "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserPhoneLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserPhoneLink_userId_key" ON "UserPhoneLink"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "UserPhoneLink_phoneE164_key" ON "UserPhoneLink"("phoneE164");
CREATE INDEX IF NOT EXISTS "UserPhoneLink_phoneE164_idx" ON "UserPhoneLink"("phoneE164");

-- PhoneLinkCode
CREATE TABLE IF NOT EXISTS "PhoneLinkCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PhoneLinkCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PhoneLinkCode_code_key" ON "PhoneLinkCode"("code");
CREATE INDEX IF NOT EXISTS "PhoneLinkCode_userId_expiresAt_idx" ON "PhoneLinkCode"("userId", "expiresAt");

-- WhatsAppMessage
CREATE TABLE IF NOT EXISTS "WhatsAppMessage" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "phoneE164" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'wame',
  "wamId" TEXT,
  "kind" TEXT NOT NULL,
  "content" TEXT,
  "mediaUrl" TEXT,
  "raw" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppMessage_wamId_key" ON "WhatsAppMessage"("wamId");
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_phoneE164_createdAt_idx" ON "WhatsAppMessage"("phoneE164", "createdAt");
CREATE INDEX IF NOT EXISTS "WhatsAppMessage_userId_createdAt_idx" ON "WhatsAppMessage"("userId", "createdAt");
