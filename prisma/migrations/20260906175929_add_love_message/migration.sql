-- CreateTable
CREATE TABLE "LoveMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "safetyCategory" TEXT,
    "citations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoveMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoveMessage_userId_createdAt_idx" ON "LoveMessage"("userId", "createdAt");
