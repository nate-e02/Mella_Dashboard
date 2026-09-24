import "server-only";
import type { AccountStatus, Prisma, TemplatePhase } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeAccountMetricsFromDb, computeConsistency } from "@/lib/services/accountMetrics";
import { roundCurrency } from "@/lib/services/calculations";
import { maxDrawdownFloor, type ConsistencyResult } from "@/lib/services/challengeRules";
import type { TemplateSnapshot } from "@/types";
import type { AccountState, PositionInfo } from "@/trading/protocol";

/**
 * Builds the terminal/dashboard `AccountState` (the same shape the trading
 * worker streams over the `account:<id>` channel) from the database, so a
 * page can render a complete, correct state before the socket connects and
 * the dashboard needs no worker at all.
 */

export const ACCOUNT_CURRENCY = "ETB";
export const TRADABLE_STATUSES: readonly AccountStatus[] = ["ACTIVE", "FUNDED"];

const accountSelect = {
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
  marginUsed: true,
  expiresAt: true,
  createdAt: true,
  failureReason: true,
} satisfies Prisma.TradingAccountSelect;

type AccountRow = Prisma.TradingAccountGetPayload<{ select: typeof accountSelect }>;

/** The challenge's holding / news / consistency rules (legacy snapshots without a flag allow it). */
export type AccountRules = {
  weekendHoldingAllowed: boolean;
  overnightHoldingAllowed: boolean;
  newsTradingAllowed: boolean;
  /** Best day may be at most this % of total profit; null = no consistency rule. */
  consistencyLimitPercent: number | null;
};

/** Account facts the UI needs alongside the live state (name, phase, dates). */
export type AccountMeta = {
  id: string;
  name: string;
  phase: TemplatePhase;
  status: AccountStatus;
  startingBalance: number;
  leverage: number;
  createdAt: string;
  expiresAt: string | null;
  failureReason: string | null;
  tradable: boolean;
  rules: AccountRules;
};

/** `consistency` is null when the challenge has no consistency rule. */
export type AccountStateEntry = { meta: AccountMeta; state: AccountState; consistency: ConsistencyResult | null };

export function toPositionInfo(p: {
  id: string;
  accountId: string;
  symbol: string;
  side: "BUY" | "SELL";
  volume: number;
  entryPrice: number;
  currentPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  floatingPnl: number;
  marginUsed: number;
  openedAt: Date;
}): PositionInfo {
  return {
    id: p.id,
    accountId: p.accountId,
    symbol: p.symbol,
    side: p.side,
    volume: p.volume,
    entryPrice: p.entryPrice,
    currentPrice: p.currentPrice,
    stopLoss: p.stopLoss,
    takeProfit: p.takeProfit,
    floatingPnl: p.floatingPnl,
    marginUsed: p.marginUsed,
    openedAt: p.openedAt.toISOString(),
  };
}

function snapshotOf(row: AccountRow): Partial<TemplateSnapshot> {
  return (row.snapshot as Partial<TemplateSnapshot> | null) ?? {};
}

export function toAccountMeta(row: AccountRow): AccountMeta {
  const snap = snapshotOf(row);
  return {
    id: row.id,
    name: snap.name ?? "Trading Account",
    phase: row.phase,
    status: row.status,
    startingBalance: row.startingBalance,
    leverage: snap.leverage && snap.leverage > 0 ? snap.leverage : 100,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    failureReason: row.failureReason,
    tradable: TRADABLE_STATUSES.includes(row.status),
    rules: rulesOf(snap),
  };
}

export function rulesOf(snap: Partial<TemplateSnapshot>): AccountRules {
  const limit = snap.consistencyRequirement;
  return {
    weekendHoldingAllowed: snap.weekendHoldingAllowed !== false,
    overnightHoldingAllowed: snap.overnightHoldingAllowed !== false,
    newsTradingAllowed: snap.newsTradingAllowed !== false,
    consistencyLimitPercent: limit != null && limit > 0 ? limit : null,
  };
}

async function consistencyForRow(row: AccountRow): Promise<ConsistencyResult | null> {
  if (rulesOf(snapshotOf(row)).consistencyLimitPercent == null) return null;
  return computeConsistency({ id: row.id, snapshot: row.snapshot });
}

async function stateForRow(row: AccountRow): Promise<AccountState> {
  const snap = snapshotOf(row);
  const [metrics, openPositions] = await Promise.all([
    computeAccountMetricsFromDb({ id: row.id, startingBalance: row.startingBalance, snapshot: row.snapshot }),
    prisma.position.findMany({ where: { accountId: row.id, status: "OPEN" }, orderBy: { openedAt: "asc" } }),
  ]);

  const balance = metrics.balance;
  const equity = metrics.equity;
  const marginUsed = roundCurrency(openPositions.reduce((sum, p) => sum + p.marginUsed, 0));

  const dailyAnchor = roundCurrency(row.dailyAnchorBalance);
  const dailyDrawdownPercent = snap.dailyDrawdown ?? 0;
  const dailyLossLimit = roundCurrency(dailyAnchor * (dailyDrawdownPercent / 100));
  const dailyLossUsed = Math.max(0, roundCurrency(dailyAnchor - equity));

  const rawFloor = maxDrawdownFloor({
    startingBalance: row.startingBalance,
    highWaterMark: row.highWaterMark,
    maxDrawdownPercent: snap.maxDrawdown ?? 0,
    mode: snap.drawdownMode,
  });
  // A disabled rule yields -Infinity, which JSON cannot carry; floor at zero equity instead.
  const drawdownFloor = Number.isFinite(rawFloor) ? rawFloor : 0;
  const drawdownRemaining = roundCurrency(equity - drawdownFloor);

  const profitTarget =
    snap.profitTarget != null && snap.profitTarget > 0 ? roundCurrency(row.startingBalance * (snap.profitTarget / 100)) : null;
  const profitProgress = profitTarget ? Math.min(100, Math.max(0, (metrics.realizedPnl / profitTarget) * 100)) : null;

  return {
    accountId: row.id,
    status: row.status,
    currency: ACCOUNT_CURRENCY,
    balance,
    equity,
    marginUsed,
    freeMargin: roundCurrency(equity - marginUsed),
    realizedPnl: metrics.realizedPnl,
    floatingPnl: metrics.unrealizedPnl,
    dailyAnchor,
    dailyLossUsed,
    dailyLossLimit,
    drawdownFloor,
    drawdownRemaining,
    profitTarget,
    profitProgress,
    tradingDays: metrics.tradingDays,
    minTradingDays: snap.minTradingDays ?? 0,
    positions: openPositions.map(toPositionInfo),
  };
}

/** Full live-state shape for one account. Throws if the account does not exist (callers check ownership first). */
export async function computeAccountState(accountId: string): Promise<AccountState> {
  const row = await prisma.tradingAccount.findUnique({ where: { id: accountId }, select: accountSelect });
  if (!row) throw new Error(`Account ${accountId} not found`);
  return stateForRow(row);
}

/** State + metadata for one account (terminal header, dashboard card). */
export async function getAccountStateEntry(accountId: string): Promise<AccountStateEntry | null> {
  const row = await prisma.tradingAccount.findUnique({ where: { id: accountId }, select: accountSelect });
  if (!row) return null;
  const [state, consistency] = await Promise.all([stateForRow(row), consistencyForRow(row)]);
  return { meta: toAccountMeta(row), state, consistency };
}

/** Every account of a user, newest first, each with its computed state. */
export async function listUserAccountStates(userId: string): Promise<AccountStateEntry[]> {
  const rows = await prisma.tradingAccount.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: accountSelect });
  const entries: AccountStateEntry[] = [];
  // Few accounts per user; sequential keeps the connection pool free for the app.
  for (const row of rows) entries.push({ meta: toAccountMeta(row), state: await stateForRow(row), consistency: await consistencyForRow(row) });
  return entries;
}

/** The user's accounts that can currently place orders, newest first. */
export async function listTradableAccounts(userId: string): Promise<AccountMeta[]> {
  const rows = await prisma.tradingAccount.findMany({
    where: { userId, status: { in: [...TRADABLE_STATUSES] } },
    orderBy: { createdAt: "desc" },
    select: accountSelect,
  });
  return rows.map(toAccountMeta);
}

/** Open positions for an account, oldest first. */
export async function listOpenPositions(accountId: string): Promise<PositionInfo[]> {
  const rows = await prisma.position.findMany({ where: { accountId, status: "OPEN" }, orderBy: { openedAt: "asc" } });
  return rows.map(toPositionInfo);
}

export type ClosedTradeInfo = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  volume: number;
  entryPrice: number;
  exitPrice: number | null;
  netProfit: number;
  closeReason: string | null;
  closeTime: string;
};

/** Trades closed since `since` (the account's current daily-reset boundary), newest first, with a summary. */
export async function listClosedTradesSince(accountId: string, since: Date) {
  const rows = await prisma.trade.findMany({
    where: { accountId, status: "CLOSED", archivedAt: null, closeTime: { gte: since } },
    orderBy: { closeTime: "desc" },
    take: 100,
    select: { id: true, symbol: true, side: true, volume: true, entryPrice: true, exitPrice: true, netProfit: true, closeReason: true, closeTime: true },
  });
  const items: ClosedTradeInfo[] = rows.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    side: t.side,
    volume: t.volume,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    netProfit: t.netProfit,
    closeReason: t.closeReason,
    closeTime: (t.closeTime ?? new Date()).toISOString(),
  }));
  const netPnl = roundCurrency(items.reduce((s, t) => s + t.netProfit, 0));
  return {
    since: since.toISOString(),
    count: items.length,
    wins: items.filter((t) => t.netProfit > 0).length,
    losses: items.filter((t) => t.netProfit < 0).length,
    netPnl,
    items,
  };
}
