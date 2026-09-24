import { describe, expect, it } from "vitest";
import { determineChallengeTransition, isLegalManualTransition, maxDrawdownFloor, type ChallengeDecisionInput } from "@/lib/services/challengeRules";

const BASE_SNAPSHOT = { maxDrawdown: 10, dailyDrawdown: 5, profitTarget: 8, minTradingDays: 5 };

function baseInput(overrides: Partial<ChallengeDecisionInput> = {}): ChallengeDecisionInput {
  return {
    status: "ACTIVE",
    phase: "PHASE_1",
    startingBalance: 10000,
    netPnl: 0,
    equity: 10000,
    highWaterMark: 10000,
    dailyAnchorBalance: 10000,
    tradingDays: 5,
    snapshot: BASE_SNAPSHOT,
    ...overrides,
  };
}

describe("determineChallengeTransition - profit target", () => {
  it("stays ACTIVE one cent below the exact target", () => {
    // 8% of 10000 = 800.00 exactly
    const decision = determineChallengeTransition(baseInput({ netPnl: 799.99, equity: 10799.99 }));
    expect(decision.meetsTarget).toBe(false);
    expect(decision.nextStatus).toBe("ACTIVE");
  });

  it("passes at exactly the target", () => {
    const decision = determineChallengeTransition(baseInput({ netPnl: 800, equity: 10800 }));
    expect(decision.meetsTarget).toBe(true);
    expect(decision.nextStatus).toBe("PASSED");
  });

  it("passes one cent above the target", () => {
    const decision = determineChallengeTransition(baseInput({ netPnl: 800.01, equity: 10800.01 }));
    expect(decision.nextStatus).toBe("PASSED");
  });

  it("is not fooled by ordinary floating point noise around the boundary", () => {
    // 10000 * 0.08 is not exactly 800 in binary floating point; a naive
    // `netPnl >= startingBalance * (profitTarget / 100)` comparison can flip
    // depending on rounding direction. Net P&L built from realistic cent
    // amounts must still resolve to a pass right at the boundary.
    const netPnl = 0.1 + 0.2 + 799.7; // sums to 800 with intermediate FP noise
    const decision = determineChallengeTransition(baseInput({ netPnl, equity: 10000 + netPnl }));
    expect(decision.nextStatus).toBe("PASSED");
  });

  it("does not pass if the minimum trading days requirement isn't met, even at target", () => {
    const decision = determineChallengeTransition(baseInput({ netPnl: 900, equity: 10900, tradingDays: 2 }));
    expect(decision.meetsTarget).toBe(true);
    expect(decision.meetsMinDays).toBe(false);
    expect(decision.nextStatus).toBe("ACTIVE");
  });

  it("never auto-passes a FUNDED account, regardless of profit", () => {
    const decision = determineChallengeTransition(
      baseInput({ phase: "FUNDED", status: "FUNDED", netPnl: 5000, equity: 15000, snapshot: { ...BASE_SNAPSHOT, profitTarget: null } }),
    );
    expect(decision.nextStatus).toBe("FUNDED");
  });

  it("never passes when profitTarget is not configured (null)", () => {
    const decision = determineChallengeTransition(baseInput({ netPnl: 100000, equity: 110000, snapshot: { ...BASE_SNAPSHOT, profitTarget: null } }));
    expect(decision.meetsTarget).toBe(false);
    expect(decision.nextStatus).toBe("ACTIVE");
  });
});

describe("determineChallengeTransition - drawdown", () => {
  it("stays ACTIVE one cent above (better than) the max drawdown boundary", () => {
    // 10% of a 10000 high water mark = 1000.00 max loss. dailyAnchorBalance
    // is pinned to the same equity (no movement "today") so this isolates
    // the overall drawdown boundary from the tighter 5% daily limit.
    const decision = determineChallengeTransition(
      baseInput({ highWaterMark: 10000, dailyAnchorBalance: 9000.01, equity: 9000.01, netPnl: -999.99 }),
    );
    expect(decision.ddBreach).toBe(false);
    expect(decision.nextStatus).toBe("ACTIVE");
  });

  it("fails at exactly the max drawdown boundary", () => {
    const decision = determineChallengeTransition(
      baseInput({ highWaterMark: 10000, dailyAnchorBalance: 9000, equity: 9000, netPnl: -1000 }),
    );
    expect(decision.ddBreach).toBe(true);
    expect(decision.nextStatus).toBe("FAILED");
  });

  it("fails one cent past the max drawdown boundary", () => {
    const decision = determineChallengeTransition(
      baseInput({ highWaterMark: 10000, dailyAnchorBalance: 8999.99, equity: 8999.99, netPnl: -1000.01 }),
    );
    expect(decision.nextStatus).toBe("FAILED");
  });

  it("STATIC mode measures from the starting balance regardless of the high water mark", () => {
    // Peak was 11000; static floor is still 10000 - 1000 = 9000.
    const decision = determineChallengeTransition(baseInput({ highWaterMark: 11000, equity: 9950, netPnl: -50 }));
    expect(decision.ddBreach).toBe(false);
    expect(decision.maxDrawdownFloor).toBe(9000);
  });

  it("TRAILING mode trails the peak until it locks at breakeven", () => {
    expect(maxDrawdownFloor({ startingBalance: 10000, highWaterMark: 10500, maxDrawdownPercent: 10, mode: "TRAILING" })).toBe(9500);
    expect(maxDrawdownFloor({ startingBalance: 10000, highWaterMark: 11000, maxDrawdownPercent: 10, mode: "TRAILING" })).toBe(10000);
    expect(maxDrawdownFloor({ startingBalance: 10000, highWaterMark: 13000, maxDrawdownPercent: 10, mode: "TRAILING" })).toBe(10000);
    const decision = determineChallengeTransition(
      baseInput({ highWaterMark: 11000, equity: 9999, netPnl: -1, snapshot: { ...BASE_SNAPSHOT, drawdownMode: "TRAILING" } }),
    );
    expect(decision.ddBreach).toBe(true);
  });

  it("a zero or negative limit disables that rule instead of failing every account", () => {
    const decision = determineChallengeTransition(baseInput({ snapshot: { ...BASE_SNAPSHOT, maxDrawdown: 0, dailyDrawdown: 0 }, equity: 10000 }));
    expect(decision.ddBreach).toBe(false);
    expect(decision.dailyBreach).toBe(false);
    expect(decision.nextStatus).toBe("ACTIVE");
  });

  it("fails an expired challenge that has not met its target, with reason EXPIRED", () => {
    const decision = determineChallengeTransition(baseInput({ netPnl: 100, equity: 10100, expired: true }));
    expect(decision.nextStatus).toBe("FAILED");
    expect(decision.failureReason).toBe("EXPIRED");
  });

  it("passes an expired challenge that did meet its target", () => {
    const decision = determineChallengeTransition(baseInput({ netPnl: 800, equity: 10800, expired: true }));
    expect(decision.nextStatus).toBe("PASSED");
  });

  it("fails on the daily drawdown limit independently of the overall limit", () => {
    // 5% daily limit on a 10000 anchor = 500; overall 10% limit not touched.
    const decision = determineChallengeTransition(baseInput({ dailyAnchorBalance: 10000, highWaterMark: 10000, equity: 9500, netPnl: -500 }));
    expect(decision.dailyBreach).toBe(true);
    expect(decision.ddBreach).toBe(false);
    expect(decision.nextStatus).toBe("FAILED");
  });

  it("fails even a FUNDED account on drawdown breach", () => {
    const decision = determineChallengeTransition(
      baseInput({ phase: "FUNDED", status: "FUNDED", highWaterMark: 10000, equity: 8900, netPnl: -1100 }),
    );
    expect(decision.nextStatus).toBe("FAILED");
  });

  it("prioritizes failure over passing when both conditions are met by the same result", () => {
    // Net P&L clears the profit target, but today's loss from the day's
    // opening equity (12000 -> 10800 = 10%) breaches the 5% daily limit -
    // breaching risk limits fails the challenge even though the trader is
    // nominally profitable overall.
    const decision = determineChallengeTransition(baseInput({ dailyAnchorBalance: 12000, highWaterMark: 12000, equity: 10800, netPnl: 800 }));
    expect(decision.meetsTarget).toBe(true);
    expect(decision.dailyBreach).toBe(true);
    expect(decision.nextStatus).toBe("FAILED");
    expect(decision.failureReason).toBe("DAILY_LOSS");
  });
});

describe("determineChallengeTransition - terminal / already-decided accounts", () => {
  it("does not re-evaluate an already PASSED account, even if it would now breach drawdown", () => {
    const decision = determineChallengeTransition(
      baseInput({ status: "PASSED", highWaterMark: 10000, equity: 8000, netPnl: -2000 }),
    );
    expect(decision.canAutoEvaluate).toBe(false);
    expect(decision.nextStatus).toBe("PASSED");
  });

  it("does not re-evaluate an already FAILED account, even if it would now meet the profit target", () => {
    const decision = determineChallengeTransition(baseInput({ status: "FAILED", netPnl: 5000, equity: 15000 }));
    expect(decision.canAutoEvaluate).toBe(false);
    expect(decision.nextStatus).toBe("FAILED");
  });

  it("does not auto-transition a SUSPENDED account", () => {
    const decision = determineChallengeTransition(baseInput({ status: "SUSPENDED", netPnl: 5000, equity: 15000 }));
    expect(decision.nextStatus).toBe("SUSPENDED");
  });

  it("does not auto-transition a FROZEN account", () => {
    const decision = determineChallengeTransition(
      baseInput({ status: "FROZEN", highWaterMark: 10000, equity: 8000, netPnl: -2000 }),
    );
    expect(decision.nextStatus).toBe("FROZEN");
  });

  it("is a no-op for an account with no trades (zero P&L, equity at starting balance)", () => {
    const decision = determineChallengeTransition(baseInput({ netPnl: 0, equity: 10000, tradingDays: 0 }));
    expect(decision.nextStatus).toBe("ACTIVE");
    expect(decision.ddBreach).toBe(false);
    expect(decision.dailyBreach).toBe(false);
  });
});

describe("isLegalManualTransition", () => {
  it("allows suspend/freeze/fail from live statuses and reinstatement back to the phase's live status", () => {
    expect(isLegalManualTransition("ACTIVE", "SUSPENDED", "PHASE_1")).toBe(true);
    expect(isLegalManualTransition("FUNDED", "FAILED", "FUNDED")).toBe(true);
    expect(isLegalManualTransition("FAILED", "ACTIVE", "PHASE_1")).toBe(true);
    expect(isLegalManualTransition("SUSPENDED", "FUNDED", "FUNDED")).toBe(true);
  });

  it("never allows PASSED by hand, a FUNDED status on a non-funded phase, or a no-op", () => {
    expect(isLegalManualTransition("ACTIVE", "PASSED", "PHASE_1")).toBe(false);
    expect(isLegalManualTransition("ACTIVE", "FUNDED", "PHASE_1")).toBe(false);
    expect(isLegalManualTransition("ACTIVE", "ACTIVE", "PHASE_1")).toBe(false);
    expect(isLegalManualTransition("PASSED", "ACTIVE", "PHASE_1")).toBe(false);
  });
});
