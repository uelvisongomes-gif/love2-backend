ALTER TABLE "CoupleTask" ADD COLUMN "category" TEXT;
ALTER TABLE "CoupleTask" ADD COLUMN "assignedTo" TEXT;
CREATE INDEX "CoupleTask_coupleId_category_idx" ON "CoupleTask"("coupleId", "category");
CREATE INDEX "CoupleTask_assignedTo_idx" ON "CoupleTask"("assignedTo");
