CREATE TABLE "SafetyScreening" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hasViolenceHistory" BOOLEAN NOT NULL,
    "hasSuicidalIdeation" BOOLEAN NOT NULL,
    "hasSubstanceAbuse" BOOLEAN NOT NULL,
    "hasChildSafetyConcerns" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyScreening_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SafetyScreening_userId_key" ON "SafetyScreening"("userId");
