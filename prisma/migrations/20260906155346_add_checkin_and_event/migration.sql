CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "moodOverall" INTEGER NOT NULL,
    "intimacyToday" BOOLEAN NOT NULL DEFAULT false,
    "dateNightToday" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckIn_userId_date_key" ON "CheckIn"("userId", "date");
CREATE INDEX "CheckIn_userId_date_idx" ON "CheckIn"("userId", "date");

CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "checkInId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "pillar" TEXT NOT NULL,
    "intensity" INTEGER NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Event_checkInId_idx" ON "Event"("checkInId");

ALTER TABLE "Event" ADD CONSTRAINT "Event_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "CheckIn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
