/*
  Warnings:

  - You are about to drop the column `embedding` on the `Source` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Source_embedding_idx";

-- AlterTable
ALTER TABLE "Source" DROP COLUMN "embedding";

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "loveLanguagesRanking" JSONB,
    "pillarScores" JSONB,
    "preferences" JSONB,
    "relationshipYears" INTEGER,
    "hasChildren" BOOLEAN,
    "livingTogether" BOOLEAN,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");
