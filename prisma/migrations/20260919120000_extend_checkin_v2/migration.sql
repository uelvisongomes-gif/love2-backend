-- Adiciona campos do Check-in v2 (sliders 1-5 + nota aberta)
ALTER TABLE "CheckIn" ADD COLUMN "connectionScore" INTEGER;
ALTER TABLE "CheckIn" ADD COLUMN "communicationScore" INTEGER;
ALTER TABLE "CheckIn" ADD COLUMN "affectionScore" INTEGER;
ALTER TABLE "CheckIn" ADD COLUMN "partnershipScore" INTEGER;
ALTER TABLE "CheckIn" ADD COLUMN "emotionalScore" INTEGER;
ALTER TABLE "CheckIn" ADD COLUMN "openNote" TEXT;
