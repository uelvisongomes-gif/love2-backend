ALTER TABLE "CoupleTask" ADD COLUMN "recurrence" TEXT;
ALTER TABLE "CoupleTask" ADD COLUMN "remindAt" TIMESTAMP(3);

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

CREATE TABLE "TaskReminderLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "remindAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskReminderLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaskReminderLog_taskId_remindAt_key" ON "TaskReminderLog"("taskId", "remindAt");
CREATE INDEX "TaskReminderLog_taskId_idx" ON "TaskReminderLog"("taskId");
