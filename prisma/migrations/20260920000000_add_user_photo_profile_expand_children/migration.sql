-- User photo
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "photoUrl" TEXT;

-- Profile expansion
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "birthDate" DATE;
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "gender" TEXT;
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "occupation" TEXT;
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "location" TEXT;
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "healthNotes" TEXT;
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "civilStatus" TEXT;
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "relationshipStart" DATE;
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "howMet" TEXT;

-- Child model
CREATE TABLE IF NOT EXISTS "Child" (
  "id" TEXT NOT NULL,
  "coupleId" TEXT,
  "createdBy" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "birthDate" DATE,
  "gender" TEXT,
  "photoUrl" TEXT,
  "parentage" TEXT,
  "livesWith" TEXT,
  "schoolInfo" TEXT,
  "healthNotes" TEXT,
  "personality" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Child_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Child_coupleId_idx" ON "Child"("coupleId");
CREATE INDEX IF NOT EXISTS "Child_createdBy_idx" ON "Child"("createdBy");
