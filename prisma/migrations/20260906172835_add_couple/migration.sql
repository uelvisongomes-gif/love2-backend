-- CreateTable
CREATE TABLE "Couple" (
    "id" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Couple_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoupleInvite" (
    "id" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeEmail" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoupleInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Couple_userAId_key" ON "Couple"("userAId");

-- CreateIndex
CREATE UNIQUE INDEX "Couple_userBId_key" ON "Couple"("userBId");

-- CreateIndex
CREATE UNIQUE INDEX "CoupleInvite_code_key" ON "CoupleInvite"("code");

-- CreateIndex
CREATE INDEX "CoupleInvite_inviterId_idx" ON "CoupleInvite"("inviterId");

-- AddForeignKey
ALTER TABLE "Couple" ADD CONSTRAINT "Couple_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Couple" ADD CONSTRAINT "Couple_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
