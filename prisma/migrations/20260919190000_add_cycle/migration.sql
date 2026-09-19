CREATE TABLE "CycleProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "averageCycleDays" INTEGER NOT NULL DEFAULT 28,
    "averagePeriodDays" INTEGER NOT NULL DEFAULT 5,
    "premenstrualDays" INTEGER NOT NULL DEFAULT 3,
    "shareWithPartner" BOOLEAN NOT NULL DEFAULT false,
    "sharePeriodStart" BOOLEAN NOT NULL DEFAULT false,
    "sharePreMenstrual" BOOLEAN NOT NULL DEFAULT false,
    "sharePreferences" BOOLEAN NOT NULL DEFAULT false,
    "carePreferences" JSONB,
    "customNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CycleProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CycleProfile_userId_key" ON "CycleProfile"("userId");

CREATE TABLE "CyclePeriod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CyclePeriod_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CyclePeriod_userId_startDate_key" ON "CyclePeriod"("userId", "startDate");
CREATE INDEX "CyclePeriod_userId_idx" ON "CyclePeriod"("userId");

CREATE TABLE "CycleDailyLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "symptoms" JSONB NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CycleDailyLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CycleDailyLog_userId_date_key" ON "CycleDailyLog"("userId", "date");
CREATE INDEX "CycleDailyLog_userId_date_idx" ON "CycleDailyLog"("userId", "date");
