import type { AccountStatus, DrawdownMode, TemplatePhase } from "@prisma/client";
import { roundCurrency } from "@/lib/services/calculations";

/**
 * Statuses that are terminal with respect to *automatic* re-evaluation.
 * SUSPENDED/FROZEN are admin holds; FAILED and PASSED are outcomes that have
 * already been recorded (and, for PASSED, already advanced the trader to
 * their next-phase account) - none of them should be re-decided by a later
 * evaluation run against the same account.
 */
const AUTO_EVALUATION_TERMINAL_STATUSES: readonly AccountStatus[] = ["SUSPENDED", "FROZEN", "FAILED", "PASSED"];

export type ChallengeRuleSnapshot = {
  maxDrawdown: number;
  dailyDrawdown: number;
  profitTarget: number | null;
  minTradingDays: number;
  /** STATIC (from initial balance) or TRAILING (from equity high-water mark, locking at initial + limit). */
  drawdownMode?: DrawdownMode;
};

export type ChallengeDecisionInput = {
  status: AccountStatus;
  phase: TemplatePhase;
  startingBalance: number;
  netPnl: number;
  equity: number;
  highWaterMark: number;
  dailyAnchorBalance: number;
  tradingDays: number;
  snapshot: ChallengeRuleSnapshot;
  /** True when the challenge's time window has elapsed (expiresAt < now). */
  expired?: boolean;
  /**
   * Result of the consistency rule (see `consistencyCheck`), when the
   * template has one. An inconsistent account cannot pass yet but is never
   * failed for it: it keeps trading until its profit is spread out enough.
   */
  consistency?: { ok: boolean } | null;
};

export type FailureReason = "MAX_DRAWDOWN" | "DAILY_LOSS" | "EXPIRED";

export type ChallengeDecision = {
  nextStatus: AccountStatus;
  canAutoEvaluate: boolean;
  ddBreach: boolean;
  dailyBreach: boolean;
  meetsTarget: boolean;
  meetsMinDays: boolean;
  meetsConsistency: boolean;
  failureReason: FailureReason | null;
  /** Absolute equity floor below which the max-drawdown rule fails the account. */
  maxDrawdownFloor: number;
  /** Absolute equity floor below which the daily-loss rule fails the account. */
  dailyLossFloor: number;
};

/**
 * Equity level at which the max-drawdown rule breaches.
 *
 * STATIC:   startingBalance - limit                       (FTMO-style, never moves)
 * TRAILING: highWaterMark  - limit, but never above the starting balance
 *           (i.e. it trails the peak until it locks at breakeven).
 */
export function maxDrawdownFloor(input: {
  startingBalance: number;
  highWaterMark: number;
  maxDrawdownPercent: number;
  mode: DrawdownMode | undefined;
}): number {
  const limit = roundCurrency(input.startingBalance * (input.maxDrawdownPercent / 100));
  if (limit <= 0) return Number.NEGATIVE_INFINITY;
  if (input.mode === "TRAILING") {
    const trailing = roundCurrency(Math.max(input.highWaterMark, input.startingBalance) - limit);
    return Math.min(trailing, input.startingBalance);
  }
  return roundCurrency(input.startingBalance - limit);
}

/** Equity level at which the daily-loss rule breaches (anchored on the day's opening equity). */
export function dailyLossFloor(input: { dailyAnchorBalance: number; dailyDrawdownPercent: number }): number {
  const limit = roundCurrency(input.dailyAnchorBalance * (input.dailyDrawdownPercent / 100));
  if (limit <= 0) return Number.NEGATIVE_INFINITY;
  return roundCurrency(input.dailyAnchorBalance - limit);
}

/**
 * Pure decision function for the challenge status state machine. Given the
 * account's current status/phase and its recomputed metrics, decides whether
 * it should transition to PASSED or FAILED.
 *
 * All monetary boundary comparisons are done in rounded-cent terms (see
 * `roundCurrency`) so ordinary floating point noise can never move an
 * exact-boundary result to the wrong side of a `>=` comparison - a trader
 * who nets exactly their profit target, to the cent, passes; a trader one
 * cent short does not. A zero/negative limit disables that rule instead of
 * failing every account instantly.
 *
 * This function has no side effects and does not touch the database.
 */
export function determineChallengeTransition(input: ChallengeDecisionInput): ChallengeDecision {
  const canAutoEvaluate = !AUTO_EVALUATION_TERMINAL_STATUSES.includes(input.status);

  const equityC = roundCurrency(input.equity);
  const netPnlC = roundCurrency(input.netPnl);

  const ddFloor = maxDrawdownFloor({
    startingBalance: input.startingBalance,
    highWaterMark: input.highWaterMark,
    maxDrawdownPercent: input.snapshot.maxDrawdown,
    mode: input.snapshot.drawdownMode,
  });
  const ddBreach = canAutoEvaluate && equityC <= ddFloor;

  const dlFloor = dailyLossFloor({
    dailyAnchorBalance: input.dailyAnchorBalance,
    dailyDrawdownPercent: input.snapshot.dailyDrawdown,
  });
  const dailyBreach = canAutoEvaluate && equityC <= dlFloor;

  const targetAmount =
    input.snapshot.profitTarget != null && input.snapshot.profitTarget > 0
      ? roundCurrency(input.startingBalance * (input.snapshot.profitTarget / 100))
      : null;
  const meetsTarget = targetAmount !== null && netPnlC >= targetAmount;
  const meetsMinDays = input.tradingDays >= input.snapshot.minTradingDays;
  const meetsConsistency = input.consistency == null || input.consistency.ok;

  let nextStatus: AccountStatus = input.status;
  let failureReason: FailureReason | null = null;

  if (canAutoEvaluate) {
    // A drawdown breach fails the account even if the profit target was also
    // reached - you cannot "pass" a challenge by violating its risk limits
    // along the way.
    if (ddBreach) {
      nextStatus = "FAILED";
      failureReason = "MAX_DRAWDOWN";
    } else if (dailyBreach) {
      nextStatus = "FAILED";
      failureReason = "DAILY_LOSS";
    } else if (input.phase !== "FUNDED" && input.status === "ACTIVE" && meetsTarget && meetsMinDays && meetsConsistency) {
      nextStatus = "PASSED";
    } else if (input.expired && input.phase !== "FUNDED" && input.status === "ACTIVE") {
      nextStatus = "FAILED";
      failureReason = "EXPIRED";
    }
  }

  return {
    nextStatus,
    canAutoEvaluate,
    ddBreach,
    dailyBreach,
    meetsTarget,
    meetsMinDays,
    meetsConsistency,
    failureReason,
    maxDrawdownFloor: ddFloor,
    dailyLossFloor: dlFloor,
  };
}

export type ConsistencyResult = {
  /** False when the template has no consistency requirement (then `ok` is always true). */
  enabled: boolean;
  ok: boolean;
  limitPercent: number | null;
  /** Best single trading day's net profit (0 when no day was profitable). */
  bestDay: number;
  /** Net profit over all trading days. */
  total: number;
  /** bestDay / total in percent, or null while total <= 0 (not evaluable yet). */
  ratioPercent: number | null;
};

/**
 * Consistency rule: the best single trading day's net profit must be at most
 * `limitPercent`% of the total net profit, so a challenge cannot be passed
 * (or a payout drawn) on one lucky day. Disabled when the limit is unset or
 * not positive. With no net profit yet the rule cannot be satisfied (there is
 * nothing to pass on). Cent-exact like the other money comparisons: a best
 * day of exactly the limit passes.
 */
export function consistencyCheck(input: { dailyNetProfits: readonly number[]; limitPercent: number | null | undefined }): ConsistencyResult {
  const limit = input.limitPercent != null && Number.isFinite(input.limitPercent) && input.limitPercent > 0 ? input.limitPercent : null;
  const total = roundCurrency(input.dailyNetProfits.reduce((s, v) => s + v, 0));
  const bestDay = roundCurrency(Math.max(0, ...input.dailyNetProfits));
  const ratioPercent = total > 0 ? Math.round((bestDay / total) * 10_000) / 100 : null;
  if (limit == null) return { enabled: false, ok: true, limitPercent: null, bestDay, total, ratioPercent };
  const ok = total > 0 && bestDay <= roundCurrency(total * (limit / 100));
  return { enabled: true, ok, limitPercent: limit, bestDay, total, ratioPercent };
}

/**
 * Legal admin-driven status transitions. PASSED is never set by hand: it can
 * only come from the rules engine, which also creates the next-phase account.
 */
export function isLegalManualTransition(from: AccountStatus, to: AccountStatus, phase: TemplatePhase): boolean {
  if (from === to) return false;
  const reinstateTarget: AccountStatus = phase === "FUNDED" ? "FUNDED" : "ACTIVE";
  switch (to) {
    case "SUSPENDED":
    case "FROZEN":
      return from === "ACTIVE" || from === "FUNDED" || from === "SUSPENDED" || from === "FROZEN";
    case "FAILED":
      return from === "ACTIVE" || from === "FUNDED" || from === "SUSPENDED" || from === "FROZEN";
    case "ACTIVE":
    case "FUNDED":
      return to === reinstateTarget && (from === "SUSPENDED" || from === "FROZEN" || from === "FAILED");
    case "PASSED":
      return false;
    default:
      return false;
  }
}
