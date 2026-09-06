import type { AccountStatus, TemplatePhase } from "@prisma/client";
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
};

export type ChallengeDecision = {
  nextStatus: AccountStatus;
  canAutoEvaluate: boolean;
  ddBreach: boolean;
  dailyBreach: boolean;
  meetsTarget: boolean;
  meetsMinDays: boolean;
};

/**
 * Pure decision function for the challenge status state machine. Given the
 * account's current status/phase and its recomputed metrics, decides whether
 * it should transition to PASSED or FAILED.
 *
 * All monetary boundary comparisons are done in rounded-cent terms (see
 * `roundCurrency`) so ordinary floating point noise can never move an
 * exact-boundary result to the wrong side of a `>=` comparison - a trader
 * who nets exactly their profit target, to the cent, passes; a trader one
 * cent short does not.
 *
 * This function has no side effects and does not touch the database, which
 * is what makes the full edge-case matrix (exact boundaries, already
 * passed/failed accounts, funded accounts, missing profit target, etc.)
 * cheaply unit-testable.
 */
export function determineChallengeTransition(input: ChallengeDecisionInput): ChallengeDecision {
  const canAutoEvaluate = !AUTO_EVALUATION_TERMINAL_STATUSES.includes(input.status);

  const highWaterMarkC = roundCurrency(input.highWaterMark);
  const equityC = roundCurrency(input.equity);
  const dailyAnchorC = roundCurrency(input.dailyAnchorBalance);
  const netPnlC = roundCurrency(input.netPnl);

  const maxDrawdownAmount = roundCurrency(highWaterMarkC * (input.snapshot.maxDrawdown / 100));
  const currentDrawdownAmount = roundCurrency(Math.max(0, highWaterMarkC - equityC));
  const ddBreach = canAutoEvaluate && currentDrawdownAmount >= maxDrawdownAmount;

  const dailyDrawdownAmount = roundCurrency(dailyAnchorC * (input.snapshot.dailyDrawdown / 100));
  const currentDailyDrawdownAmount = roundCurrency(Math.max(0, dailyAnchorC - equityC));
  const dailyBreach = canAutoEvaluate && currentDailyDrawdownAmount >= dailyDrawdownAmount;

  const targetAmount =
    input.snapshot.profitTarget != null ? roundCurrency(input.startingBalance * (input.snapshot.profitTarget / 100)) : null;
  const meetsTarget = targetAmount !== null && netPnlC >= targetAmount;
  const meetsMinDays = input.tradingDays >= input.snapshot.minTradingDays;

  let nextStatus: AccountStatus = input.status;

  if (canAutoEvaluate) {
    // A drawdown breach fails the account even if the profit target was also
    // reached - you cannot "pass" a challenge by violating its risk limits
    // along the way. This matches the platform's existing behavior; only the
    // precision and PASSED-terminality of the comparison have changed here.
    if (ddBreach || dailyBreach) {
      nextStatus = "FAILED";
    } else if (input.phase !== "FUNDED" && input.status === "ACTIVE" && meetsTarget && meetsMinDays) {
      nextStatus = "PASSED";
    }
  }

  return { nextStatus, canAutoEvaluate, ddBreach, dailyBreach, meetsTarget, meetsMinDays };
}
