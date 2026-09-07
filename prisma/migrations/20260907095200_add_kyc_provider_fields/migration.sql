-- AlterTable: add provider/providerReference/failureReason for real KYC
-- verification providers (Dojah), and relax fullName/country/documentType to
-- nullable since a provider-driven submission's own hosted flow collects
-- identity details itself rather than the legacy manual self-report form.
-- No data is dropped or renamed; all existing rows keep their values (with
-- provider defaulting to 'MANUAL', matching their pre-existing manual-review
-- behavior).
ALTER TABLE "KycSubmission" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "providerReference" TEXT,
ALTER COLUMN "fullName" DROP NOT NULL,
ALTER COLUMN "country" DROP NOT NULL,
ALTER COLUMN "documentType" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "KycSubmission_providerReference_key" ON "KycSubmission"("providerReference");
