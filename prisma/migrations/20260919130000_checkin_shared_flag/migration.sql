ALTER TABLE "CheckIn" ADD COLUMN "sharedWithPartner" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "CheckIn_sharedWithPartner_idx" ON "CheckIn"("sharedWithPartner");
