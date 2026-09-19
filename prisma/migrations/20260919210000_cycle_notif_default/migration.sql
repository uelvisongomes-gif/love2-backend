-- Muda default do premenstrualDays de 3 pra 5 (mais realista)
ALTER TABLE "CycleProfile" ALTER COLUMN "premenstrualDays" SET DEFAULT 5;

-- Log de notificações do ciclo pra evitar enviar 2x no mesmo dia
CREATE TABLE "CycleNotificationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CycleNotificationLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CycleNotificationLog_userId_kind_sentDate_key" ON "CycleNotificationLog"("userId", "kind", "sentDate");
CREATE INDEX "CycleNotificationLog_userId_idx" ON "CycleNotificationLog"("userId");
