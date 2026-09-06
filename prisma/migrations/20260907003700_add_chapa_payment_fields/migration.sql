-- AlterEnum: add FAILED as a distinguishable payment outcome, alongside the
-- existing PENDING/PAID/REFUNDED/CANCELLED values. Existing rows are
-- unaffected - this only adds a new allowed value.
ALTER TYPE "PurchaseStatus" ADD VALUE 'FAILED';

-- AlterTable: rename demoTransactionId -> providerTxRef. This is a pure
-- rename (not a drop+recreate), so all existing values and the unique
-- constraint/index are preserved unchanged - it's the same column, now
-- accurately named for its role as the general payment-provider
-- transaction reference (Chapa's tx_ref, or a synthetic reference for the
-- admin test-paid action / legacy seed data) rather than only "demo".
ALTER TABLE "Purchase" RENAME COLUMN "demoTransactionId" TO "providerTxRef";
ALTER INDEX "Purchase_demoTransactionId_key" RENAME TO "Purchase_providerTxRef_key";
