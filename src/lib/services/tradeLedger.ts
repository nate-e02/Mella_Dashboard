import "server-only";
import { Prisma, type CloseReason, type OrderType, type Position, type TradeSide, type TradingAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roundCurrency } from "@/lib/services/calculations";
import { evaluateAccount } from "@/lib/services/challengeEngine";
import { ConflictError } from "@/lib/auth/guards";

/**
 * The ONLY write path for trading activity. The live engine (services
 * worker) and any future external-provider adapter call these functions;
 * they never write Trade/Position/LedgerEntry/TradingAccount money columns
 * directly. Every function is transactional and idempotent so a retried call
 * after a crash can never double-count a fill or a close.
 */

function isUniqueConstraintOn(err: unknown, field: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    Array.isArray(err.meta?.target) &&
    (err.meta.target as string[]).includes(field)
  );
}

export type OpenPositionInput = {
  accountId: string;
  symbol: string;
  side: TradeSide;
  volume: number;
  entryPrice: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  /** Margin reserved for this position, in the account currency. */
  marginUsed: number;
  entryTickTs?: Date;
  feedSource?: string;
  /** For a MARKET fill: the client order to create as FILLED. For a pending LIMIT/STOP order being triggered: pass `existingOrderId`. */
  order: { clientOrderId: string; type: OrderType; price?: number | null; existingOrderId?: string };
};

/**
 * Records a fill: creates the FILLED Order and the OPEN Position and reserves
 * margin on the account, all in one transaction. Re-sending the same
 * (accountId, clientOrderId) returns the original result instead of opening
 * a second position.
 */
export async function openPosition(input: OpenPositionInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const account = await tx.tradingAccount.findUniqueOrThrow({ where: { id: input.accountId }, select: { status: true, marginUsed: true } });
      if (account.status !== "ACTIVE" && account.status !== "FUNDED") {
        throw new ConflictError(`Account is ${account.status}; trading is not allowed`);
      }

      const position = await tx.position.create({
        data: {
          accountId: input.accountId,
          symbol: input.symbol,
          side: input.side,
          volume: input.volume,
          entryPrice: input.entryPrice,
          stopLoss: input.stopLoss ?? null,
          takeProfit: input.takeProfit ?? null,
          marginUsed: roundCurrency(input.marginUsed),
          currentPrice: input.entryPrice,
          floatingPnl: 0,
          entryTickTs: input.entryTickTs ?? null,
          feedSource: input.feedSource ?? null,
          status: "OPEN",
        },
      });

      const order = input.order.existingOrderId
        ? await tx.order.update({
            where: { id: input.order.existingOrderId },
            data: { status: "FILLED", filledPrice: input.entryPrice, filledAt: new Date(), positionId: position.id },
          })
        : await tx.order.create({
            data: {
              accountId: input.accountId,
              symbol: input.symbol,
              clientOrderId: input.order.clientOrderId,
              side: input.side,
              type: input.order.type,
              volume: input.volume,
              price: input.order.price ?? null,
              stopLoss: input.stopLoss ?? null,
              takeProfit: input.takeProfit ?? null,
              status: "FILLED",
              filledPrice: input.entryPrice,
              filledAt: new Date(),
              positionId: position.id,
            },
          });

      await tx.tradingAccount.update({
        where: { id: input.accountId },
        data: { marginUsed: roundCurrency(account.marginUsed + input.marginUsed) },
      });

      return { position, order, duplicate: false as const };
    });
  } catch (err) {
    if (isUniqueConstraintOn(err, "clientOrderId")) {
      const order = await prisma.order.findUniqueOrThrow({
        where: { accountId_clientOrderId: { accountId: input.accountId, clientOrderId: input.order.clientOrderId } },
        include: { position: true },
      });
      return { position: order.position as Position, order, duplicate: true as const };
    }
    throw err;
  }
}

/** Records a rejected order for audit/idempotency purposes (no money effect). */
export async function recordRejectedOrder(input: {
  accountId: string;
  symbol: string;
  side: TradeSide;
  volume: number;
  type: OrderType;
  price?: number | null;
  clientOrderId: string;
  reason: string;
}) {
  try {
    return await prisma.order.create({
      data: {
        accountId: input.accountId,
        symbol: input.symbol,
        side: input.side,
        volume: input.volume,
        type: input.type,
        price: input.price ?? null,
        clientOrderId: input.clientOrderId,
        status: "REJECTED",
        rejectReason: input.reason.slice(0, 200),
      },
    });
  } catch (err) {
    if (isUniqueConstraintOn(err, "clientOrderId")) return null;
    throw err;
  }
}

export type ClosePositionInput = {
  positionId: string;
  closePrice: number;
  closedAt?: Date;
  closeReason: CloseReason;
  /** Gross P&L of the closed volume in the ACCOUNT currency (before commission/swap). */
  grossProfit: number;
  commission?: number;
  swap?: number;
  /** Omit or equal to the position volume for a full close; smaller for a partial close. */
  volume?: number;
  exitTickTs?: Date;
  fxRate?: number;
  quoteCurrency?: string;
  actorId?: string | null;
};

/**
 * Closes a position (fully or partially): writes the CLOSED Trade, the ledger
 * entries, and updates the account's balance and incremental counters in one
 * transaction, then runs the challenge rules. Closing an already-CLOSED
 * position is a no-op that returns the existing trade.
 */
export async function recordPositionClose(input: ClosePositionInput): Promise<{ trade: Prisma.TradeGetPayload<object> | null; account: TradingAccount; position: Position }> {
  const closedAt = input.closedAt ?? new Date();
  const commission = roundCurrency(input.commission ?? 0);
  const swap = roundCurrency(input.swap ?? 0);
  const gross = roundCurrency(input.grossProfit);
  const netProfit = roundCurrency(gross - commission - swap);

  const result = await prisma.$transaction(async (tx) => {
    const position = await tx.position.findUniqueOrThrow({ where: { id: input.positionId } });
    if (position.status !== "OPEN") {
      const existing = await tx.trade.findFirst({ where: { positionId: position.id }, orderBy: { closeTime: "desc" } });
      return { trade: existing, position, accountId: position.accountId, changed: false };
    }

    const closeVolume = Math.min(position.volume, input.volume ?? position.volume);
    const fullClose = closeVolume >= position.volume - 1e-9;
    const marginReleased = fullClose ? position.marginUsed : roundCurrency(position.marginUsed * (closeVolume / position.volume));

    const claim = await tx.position.updateMany({
      where: { id: position.id, status: "OPEN" },
      data: fullClose
        ? { status: "CLOSED", closedAt, closePrice: input.closePrice, closeReason: input.closeReason, floatingPnl: 0, marginUsed: 0, currentPrice: input.closePrice }
        : { volume: roundVolume(position.volume - closeVolume), marginUsed: roundCurrency(position.marginUsed - marginReleased), currentPrice: input.closePrice },
    });
    if (claim.count === 0) {
      const existing = await tx.trade.findFirst({ where: { positionId: position.id }, orderBy: { closeTime: "desc" } });
      return { trade: existing, position, accountId: position.accountId, changed: false };
    }

    const trade = await tx.trade.create({
      data: {
        accountId: position.accountId,
        symbol: position.symbol,
        side: position.side,
        volume: closeVolume,
        entryPrice: position.entryPrice,
        exitPrice: input.closePrice,
        stopLoss: position.stopLoss,
        takeProfit: position.takeProfit,
        openTime: position.openedAt,
        closeTime: closedAt,
        profit: gross,
        commission,
        swap,
        netProfit,
        status: "CLOSED",
        positionId: position.id,
        closeReason: input.closeReason,
        entryTickTs: position.entryTickTs,
        exitTickTs: input.exitTickTs ?? null,
        feedSource: position.feedSource,
        quoteCurrency: input.quoteCurrency ?? null,
        fxRate: input.fxRate ?? null,
      },
    });

    const account = await tx.tradingAccount.findUniqueOrThrow({ where: { id: position.accountId } });
    const entries: Prisma.LedgerEntryCreateManyInput[] = [
      { userId: account.userId, accountId: account.id, type: "TRADE_PNL", amount: gross, currency: "ETB", fxRate: input.fxRate ?? null, refType: "Trade", refId: trade.id, note: `${position.symbol} ${position.side} ${closeVolume}` },
    ];
    if (commission !== 0) entries.push({ userId: account.userId, accountId: account.id, type: "COMMISSION", amount: -commission, currency: "ETB", refType: "Trade", refId: trade.id });
    if (swap !== 0) entries.push({ userId: account.userId, accountId: account.id, type: "SWAP", amount: -swap, currency: "ETB", refType: "Trade", refId: trade.id });
    await tx.ledgerEntry.createMany({ data: entries });

    await tx.tradingAccount.update({
      where: { id: account.id },
      data: {
        balance: roundCurrency(account.balance + netProfit),
        realizedPnl: roundCurrency(account.realizedPnl + netProfit),
        tradeCount: { increment: 1 },
        winCount: netProfit > 0 ? { increment: 1 } : undefined,
        lossCount: netProfit < 0 ? { increment: 1 } : undefined,
        grossProfit: netProfit > 0 ? roundCurrency(account.grossProfit + netProfit) : undefined,
        grossLoss: netProfit < 0 ? roundCurrency(account.grossLoss - netProfit) : undefined,
        marginUsed: roundCurrency(Math.max(0, account.marginUsed - marginReleased)),
        lastTradeAt: closedAt,
      },
    });

    const refreshed = await tx.position.findUniqueOrThrow({ where: { id: position.id } });
    return { trade, position: refreshed, accountId: position.accountId, changed: true };
  });

  const account = result.changed
    ? await evaluateAccount(result.accountId, input.actorId ?? undefined)
    : await prisma.tradingAccount.findUniqueOrThrow({ where: { id: result.accountId } });

  return { trade: result.trade, account, position: result.position };
}

function roundVolume(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Updates stop-loss / take-profit on an open position. */
export async function updatePositionRisk(positionId: string, risk: { stopLoss?: number | null; takeProfit?: number | null }) {
  const claim = await prisma.position.updateMany({
    where: { id: positionId, status: "OPEN" },
    data: { ...(risk.stopLoss !== undefined ? { stopLoss: risk.stopLoss } : {}), ...(risk.takeProfit !== undefined ? { takeProfit: risk.takeProfit } : {}) },
  });
  if (claim.count === 0) throw new ConflictError("Position is not open");
  return prisma.position.findUniqueOrThrow({ where: { id: positionId } });
}

/**
 * Persists the engine's mark-to-market (throttled by the caller) so the web
 * app, the sweep and the rules engine all see the same floating P&L.
 */
export async function persistMarks(
  marks: { positionId: string; currentPrice: number; floatingPnl: number }[],
  accounts: { accountId: string; equity: number; marginUsed: number }[],
) {
  if (marks.length === 0 && accounts.length === 0) return;
  await prisma.$transaction([
    ...marks.map((m) =>
      prisma.position.updateMany({ where: { id: m.positionId, status: "OPEN" }, data: { currentPrice: m.currentPrice, floatingPnl: roundCurrency(m.floatingPnl) } }),
    ),
    ...accounts.map((a) =>
      prisma.tradingAccount.updateMany({
        where: { id: a.accountId },
        data: { equity: roundCurrency(a.equity), marginUsed: roundCurrency(a.marginUsed) },
      }),
    ),
  ]);
}

/**
 * Captures the daily-loss anchor at a reset boundary. Called by the live
 * engine the moment the account's reset time passes (it knows the equity at
 * that instant); the sweep/evaluateAccount path does the same lazily for
 * accounts the engine is not tracking. Idempotent per boundary.
 */
export async function captureDailyAnchor(accountId: string, equity: number, boundary: Date) {
  await prisma.tradingAccount.updateMany({
    where: { id: accountId, dailyAnchorDate: { lt: boundary } },
    data: { dailyAnchorBalance: roundCurrency(equity), dailyAnchorDate: boundary },
  });
}

export async function recordEquitySnapshot(accountId: string, balance: number, equity: number, marginUsed: number) {
  await prisma.equitySnapshot.create({ data: { accountId, balance: roundCurrency(balance), equity: roundCurrency(equity), marginUsed: roundCurrency(marginUsed) } });
}

/** Everything the live engine needs to load an account into memory. */
export async function loadEngineAccounts() {
  return prisma.tradingAccount.findMany({
    where: { status: { in: ["ACTIVE", "FUNDED"] } },
    select: {
      id: true,
      userId: true,
      status: true,
      phase: true,
      snapshot: true,
      startingBalance: true,
      balance: true,
      equity: true,
      highWaterMark: true,
      dailyAnchorBalance: true,
      dailyAnchorDate: true,
      realizedPnl: true,
      marginUsed: true,
      expiresAt: true,
      positions: { where: { status: "OPEN" } },
    },
  });
}

export async function loadEngineAccount(accountId: string) {
  return prisma.tradingAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      userId: true,
      status: true,
      phase: true,
      snapshot: true,
      startingBalance: true,
      balance: true,
      equity: true,
      highWaterMark: true,
      dailyAnchorBalance: true,
      dailyAnchorDate: true,
      realizedPnl: true,
      marginUsed: true,
      expiresAt: true,
      positions: { where: { status: "OPEN" } },
    },
  });
}

export async function loadEnabledInstruments() {
  return prisma.instrument.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" } });
}
