-- CreateEnum
CREATE TYPE "DrawdownMode" AS ENUM ('STATIC', 'TRAILING');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('MARKET', 'LIMIT', 'STOP');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'FILLED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CloseReason" AS ENUM ('MANUAL', 'STOP_LOSS', 'TAKE_PROFIT', 'BREACH', 'ADMIN', 'STOP_OUT', 'EXPIRED');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('PURCHASE', 'REFUND', 'TRADE_PNL', 'COMMISSION', 'SWAP', 'PAYOUT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "VerificationTokenType" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET', 'PHONE_OTP');

-- CreateEnum
CREATE TYPE "InstrumentCategory" AS ENUM ('FOREX', 'METAL', 'CRYPTO', 'INDEX');

-- AlterEnum
ALTER TYPE "PayoutStatus" ADD VALUE 'APPROVED';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "ip" TEXT,
ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "link" TEXT;

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'ETB',
ADD COLUMN     "destination" JSONB,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "paidById" TEXT,
ADD COLUMN     "providerRef" TEXT,
ADD COLUMN     "rejectReason" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedById" TEXT;

-- AlterTable
ALTER TABLE "Purchase" ALTER COLUMN "currency" SET DEFAULT 'ETB';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "ip" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "drawdownMode" "DrawdownMode" NOT NULL DEFAULT 'STATIC',
ALTER COLUMN "currency" SET DEFAULT 'ETB',
ALTER COLUMN "accountCurrency" SET DEFAULT 'ETB';

-- AlterTable
ALTER TABLE "Trade" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "closeReason" "CloseReason",
ADD COLUMN     "entryTickTs" TIMESTAMP(3),
ADD COLUMN     "exitTickTs" TIMESTAMP(3),
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "feedSource" TEXT,
ADD COLUMN     "fxRate" DOUBLE PRECISION,
ADD COLUMN     "positionId" TEXT,
ADD COLUMN     "quoteCurrency" TEXT;

-- AlterTable
ALTER TABLE "TradingAccount" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "grossLoss" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "grossProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "lastTradeAt" TIMESTAMP(3),
ADD COLUMN     "lossCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "marginUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "realizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "tradeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "winCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "mfaBackupCodes" JSONB,
ADD COLUMN     "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfaSecretEnc" TEXT,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "telegramChatId" TEXT;

-- CreateTable
CREATE TABLE "VerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "VerificationTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instrument" (
    "symbol" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "category" "InstrumentCategory" NOT NULL DEFAULT 'FOREX',
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "digits" INTEGER NOT NULL DEFAULT 5,
    "contractSize" DOUBLE PRECISION NOT NULL DEFAULT 100000,
    "minVolume" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    "maxVolume" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "volumeStep" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    "spreadMarkupPoints" INTEGER NOT NULL DEFAULT 0,
    "commissionPerLot" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "swapLongPerLot" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "swapShortPerLot" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feedSource" TEXT NOT NULL DEFAULT 'STUB',
    "feedSymbol" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("symbol")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "stopLoss" DOUBLE PRECISION,
    "takeProfit" DOUBLE PRECISION,
    "commission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "swap" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentPrice" DOUBLE PRECISION,
    "floatingPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marginUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "PositionStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entryTickTs" TIMESTAMP(3),
    "feedSource" TEXT,
    "closedAt" TIMESTAMP(3),
    "closePrice" DOUBLE PRECISION,
    "closeReason" "CloseReason",
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "clientOrderId" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "type" "OrderType" NOT NULL DEFAULT 'MARKET',
    "volume" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION,
    "stopLoss" DOUBLE PRECISION,
    "takeProfit" DOUBLE PRECISION,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "filledPrice" DOUBLE PRECISION,
    "filledAt" TIMESTAMP(3),
    "positionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bar" (
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Bar_pkey" PRIMARY KEY ("symbol","timeframe","time")
);

-- CreateTable
CREATE TABLE "EquitySnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "balance" DOUBLE PRECISION NOT NULL,
    "equity" DOUBLE PRECISION NOT NULL,
    "marginUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "EquitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "purchaseId" TEXT,
    "type" "LedgerEntryType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ETB',
    "fxRate" DOUBLE PRECISION,
    "refType" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_tokenHash_key" ON "VerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "VerificationToken_userId_type_idx" ON "VerificationToken"("userId", "type");

-- CreateIndex
CREATE INDEX "Instrument_enabled_sortOrder_idx" ON "Instrument"("enabled", "sortOrder");

-- CreateIndex
CREATE INDEX "Position_accountId_status_idx" ON "Position"("accountId", "status");

-- CreateIndex
CREATE INDEX "Position_status_symbol_idx" ON "Position"("status", "symbol");

-- CreateIndex
CREATE INDEX "Order_accountId_status_idx" ON "Order"("accountId", "status");

-- CreateIndex
CREATE INDEX "Order_status_symbol_idx" ON "Order"("status", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Order_accountId_clientOrderId_key" ON "Order"("accountId", "clientOrderId");

-- CreateIndex
CREATE INDEX "Bar_symbol_timeframe_time_idx" ON "Bar"("symbol", "timeframe", "time" DESC);

-- CreateIndex
CREATE INDEX "EquitySnapshot_accountId_at_idx" ON "EquitySnapshot"("accountId", "at");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_type_refType_refId_key" ON "LedgerEntry"("type", "refType", "refId");

-- CreateIndex
CREATE INDEX "FxRate_base_quote_effectiveAt_idx" ON "FxRate"("base", "quote", "effectiveAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_base_quote_effectiveAt_key" ON "FxRate"("base", "quote", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_provider_eventId_key" ON "WebhookDelivery"("provider", "eventId");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "CrmLead_createdAt_idx" ON "CrmLead"("createdAt");

-- CreateIndex
CREATE INDEX "KycSubmission_submittedAt_idx" ON "KycSubmission"("submittedAt");

-- CreateIndex
CREATE INDEX "KycSubmission_userId_provider_status_idx" ON "KycSubmission"("userId", "provider", "status");

-- CreateIndex
CREATE INDEX "Notification_userId_read_createdAt_idx" ON "Notification"("userId", "read", "createdAt");

-- CreateIndex
CREATE INDEX "Payout_status_paidAt_idx" ON "Payout"("status", "paidAt");

-- CreateIndex
CREATE INDEX "Payout_requestedAt_idx" ON "Payout"("requestedAt");

-- CreateIndex
CREATE INDEX "Payout_tradingAccountId_status_idx" ON "Payout"("tradingAccountId", "status");

-- CreateIndex
CREATE INDEX "Purchase_status_paymentDate_idx" ON "Purchase"("status", "paymentDate");

-- CreateIndex
CREATE INDEX "Purchase_createdAt_idx" ON "Purchase"("createdAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Template_status_phase_idx" ON "Template"("status", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_externalId_key" ON "Trade"("externalId");

-- CreateIndex
CREATE INDEX "Trade_accountId_openTime_idx" ON "Trade"("accountId", "openTime");

-- CreateIndex
CREATE INDEX "Trade_accountId_closeTime_idx" ON "Trade"("accountId", "closeTime");

-- CreateIndex
CREATE INDEX "Trade_positionId_idx" ON "Trade"("positionId");

-- CreateIndex
CREATE INDEX "TradingAccount_status_createdAt_idx" ON "TradingAccount"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TradingAccount_phase_status_idx" ON "TradingAccount"("phase", "status");

-- CreateIndex
CREATE INDEX "TradingAccount_status_failedAt_idx" ON "TradingAccount"("status", "failedAt");

-- CreateIndex
CREATE INDEX "TradingAccount_userId_status_idx" ON "TradingAccount"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- AddForeignKey
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TradingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "Instrument"("symbol") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TradingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "Instrument"("symbol") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquitySnapshot" ADD CONSTRAINT "EquitySnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TradingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TradingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

