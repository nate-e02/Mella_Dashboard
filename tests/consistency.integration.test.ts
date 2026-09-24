import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ConflictError } from "@/lib/auth/guards";
import { computeConsistency, dailyNetProfits } from "@/lib/services/accountMetrics";
import { evaluateAccount } from "@/lib/services/challengeEngine";
import { computePayoutAvailability, createPayout } from "@/lib/services/payouts";
import { parseResetTime } from "@/lib/services/dailyReset";
import { TestFixtures } from "./helpers/fixtures";

/**
 * Consistency rule end to end: per-trading-day aggregation in SQL (EAT reset
 * boundary), the challenge engine holding an inconsistent account at target
 * instead of passing it, and funded payouts refusing until consistent.
 */

const fixtures = new TestFixtures();
afterEach(() => fixtures.cleanup());

/** Closed trades at 10:00 EAT on consecutive September days, one per amount. */
async function tradesOnDays(accountId: string, amounts: number[]) {
  for (const [i, amount] of amounts.entries()) {
    await fixtures.addClosedTrade(accountId, amount, new Date(Date.UTC(2026, 8, 1 + i, 6, 0)));
  }
}

async function challengeAccount(consistencyRequirement: number | null) {
  const user = await fixtures.createUser();
  const template = await fixtures.createTemplate({ profitTarget: 8, minTradingDays: 0, consistencyRequirement, maxDrawdown: 10, dailyDrawdown: 5, dailyLossResetTime: "00:00 EAT" });
  const account = await fixtures.createAccount({ userId: user.id, template });
  return { user, account };
}

describe("per-day aggregation", () => {
  it("buckets closed, non-archived trades by the account's trading day", async () => {
    const { account } = await challengeAccount(40);
    // Two trades on 1 Sept EAT (one at 23:30 EAT = 20:30Z), one on 2 Sept, one archived.
    await fixtures.addClosedTrade(account.id, 100, new Date(Date.UTC(2026, 8, 1, 6, 0)));
    await fixtures.addClosedTrade(account.id, 50, new Date(Date.UTC(2026, 8, 1, 19, 30))); // closes 20:30Z = 23:30 EAT
    await fixtures.addClosedTrade(account.id, -30, new Date(Date.UTC(2026, 8, 1, 20, 30))); // closes 21:30Z = 00:30 EAT on the 2nd
    const archived = await fixtures.addClosedTrade(account.id, 999, new Date(Date.UTC(2026, 8, 3, 6, 0)));
    await prisma.trade.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    expect(await dailyNetProfits(account.id, parseResetTime("00:00 EAT"))).toEqual([150, -30]);
    expect(await computeConsistency(account)).toMatchObject({ enabled: true, ok: false, bestDay: 150, total: 120, ratioPercent: 125 });
  });
});

describe("challenge engine", () => {
  it("keeps an account that reached the target on one big day ACTIVE (never FAILED) until it is consistent", async () => {
    const { account } = await challengeAccount(40);
    await tradesOnDays(account.id, [900, 100]); // 1000 >= 800 target, best day 90%
    const after = await evaluateAccount(account.id);
    expect(after.realizedPnl).toBe(1000);
    expect(after.status).toBe("ACTIVE");
    expect(after.failureReason).toBeNull();
  });

  it("passes a consistent account at target", async () => {
    const { account } = await challengeAccount(40);
    await tradesOnDays(account.id, [300, 300, 250, 150]); // best 30%
    expect((await evaluateAccount(account.id)).status).toBe("PASSED");
  });

  it("ignores consistency when the template has no requirement", async () => {
    const { account } = await challengeAccount(null);
    await tradesOnDays(account.id, [900]);
    expect((await evaluateAccount(account.id)).status).toBe("PASSED");
  });
});

describe("funded payouts", () => {
  async function fundedAccount(amounts: number[]) {
    const trader = await fixtures.createUser("TRADER");
    const admin = await fixtures.createUser("ADMIN");
    const template = await fixtures.createTemplate({ phase: "FUNDED", profitTarget: null, profitSplit: 80, consistencyRequirement: 40 });
    const account = await fixtures.createAccount({ userId: trader.id, template, status: "FUNDED" });
    await prisma.tradingAccount.update({ where: { id: account.id }, data: { fundedAt: new Date(Date.now() - 30 * 86_400_000) } });
    await prisma.kycSubmission.create({ data: { userId: trader.id, status: "APPROVED", provider: "MANUAL", reviewedAt: new Date() } });
    await tradesOnDays(account.id, amounts);
    await evaluateAccount(account.id); // backfills balance/realizedPnl from the trades
    return { account, admin };
  }

  it("refuses a payout with a clear message while one day dominates the profit", async () => {
    const { account, admin } = await fundedAccount([3000, 500, 500]); // best 75%
    const availability = await computePayoutAvailability(account.id);
    expect(availability.available).toBe(3200);
    expect(availability.consistency).toMatchObject({ enabled: true, ok: false, ratioPercent: 75 });
    expect(availability.eligible).toBe(false);
    await expect(createPayout({ tradingAccountId: account.id, amount: 1000, requestedByUserId: admin.id, byAdmin: true })).rejects.toThrow(ConflictError);
    await expect(createPayout({ tradingAccountId: account.id, amount: 1000, requestedByUserId: admin.id, byAdmin: true })).rejects.toThrow(
      /best trading day is 75\.0% of total profit \(limit 40%\)/,
    );
    expect(await prisma.payout.count({ where: { tradingAccountId: account.id } })).toBe(0);
  });

  it("allows the payout once profit is spread out", async () => {
    const { account, admin } = await fundedAccount([1000, 1000, 1000]); // best 33.3%
    const availability = await computePayoutAvailability(account.id);
    expect(availability.consistency.ok).toBe(true);
    expect(availability.eligible).toBe(true);
    const payout = await createPayout({ tradingAccountId: account.id, amount: 1000, requestedByUserId: admin.id, byAdmin: true });
    expect(payout.status).toBe("PENDING");
  });
});
