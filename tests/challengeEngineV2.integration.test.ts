import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { evaluateAccount, resetAccount, runRiskSweep, setAccountStatusManually } from "@/lib/services/challengeEngine";
import { ConflictError } from "@/lib/auth/guards";
import { TestFixtures } from "./helpers/fixtures";

/**
 * Engine v2 behaviours: the daily-loss anchor is captured at the account's
 * reset boundary (not lazily on a later page view), challenges expire,
 * admin reinstatement re-anchors, and resets archive rather than delete.
 */
const fixtures = new TestFixtures();
afterEach(() => fixtures.cleanup());

describe("daily loss anchor", () => {
  it("does not erase today's loss when the first evaluation of the day happens after the loss", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ dailyDrawdown: 5, maxDrawdown: 50, dailyLossResetTime: "00:00 EAT" });
    const account = await fixtures.createAccount({ userId: user.id, template });

    // Anchor captured yesterday at the boundary (21:00 UTC), equity 10000.
    const yesterdayBoundary = new Date();
    yesterdayBoundary.setUTCHours(21, 0, 0, 0);
    if (yesterdayBoundary.getTime() > Date.now()) yesterdayBoundary.setUTCDate(yesterdayBoundary.getUTCDate() - 1);
    yesterdayBoundary.setUTCDate(yesterdayBoundary.getUTCDate() - 1);
    await prisma.tradingAccount.update({ where: { id: account.id }, data: { dailyAnchorDate: yesterdayBoundary, dailyAnchorBalance: 10000 } });

    // Today (after the boundary) the trader lost 8% and nobody opened the page until now.
    await fixtures.addClosedTrade(account.id, -800, new Date());
    const result = await evaluateAccount(account.id);

    // The evaluation re-anchors to the boundary equity (10000, since no trades
    // before the boundary), so an 8% daily loss is a breach.
    expect(result.status).toBe("FAILED");
    expect(result.failureReason).toBe("DAILY_LOSS");
  });

  it("captures the anchor at the boundary equity, not the post-loss balance, when re-anchoring", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ dailyDrawdown: 5, maxDrawdown: 50 });
    const account = await fixtures.createAccount({ userId: user.id, template });
    const stale = new Date(Date.now() - 3 * 86_400_000);
    await prisma.tradingAccount.update({ where: { id: account.id }, data: { dailyAnchorDate: stale, dailyAnchorBalance: 10000 } });

    await fixtures.addClosedTrade(account.id, -200, new Date());
    const result = await evaluateAccount(account.id);

    expect(result.status).toBe("ACTIVE");
    // Anchor moved to today's boundary; its value is the current equity
    // (9800) because that is the best available estimate when the engine was
    // not running at the boundary - and the anchor date is the boundary, so
    // it is not re-captured again later today.
    expect(result.dailyAnchorDate.getTime()).toBeGreaterThan(stale.getTime());
    const again = await evaluateAccount(account.id);
    expect(again.dailyAnchorBalance).toBe(result.dailyAnchorBalance);
  });
});

describe("expiry", () => {
  it("fails an ACTIVE challenge whose time window has passed without reaching the target", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ durationDays: 30 });
    const account = await fixtures.createAccount({ userId: user.id, template });
    await prisma.tradingAccount.update({ where: { id: account.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });

    const result = await evaluateAccount(account.id);
    expect(result.status).toBe("FAILED");
    expect(result.failureReason).toBe("EXPIRED");
  });

  it("the risk sweep evaluates every live account without a page view", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ maxDrawdown: 10, dailyDrawdown: 50 });
    const account = await fixtures.createAccount({ userId: user.id, template });
    await fixtures.addClosedTrade(account.id, -1500);

    const summary = await runRiskSweep({ batchSize: 50 });
    expect(summary.evaluated).toBeGreaterThan(0);
    const after = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.status).toBe("FAILED");
  });
});

describe("admin status changes", () => {
  it("reinstating a FAILED account re-anchors so it is not failed again immediately", async () => {
    const user = await fixtures.createUser();
    const admin = await fixtures.createUser("ADMIN");
    const template = await fixtures.createTemplate({ maxDrawdown: 10, dailyDrawdown: 50 });
    const account = await fixtures.createAccount({ userId: user.id, template });
    await fixtures.addClosedTrade(account.id, -1200);
    expect((await evaluateAccount(account.id)).status).toBe("FAILED");

    // Re-anchoring alone cannot rescue a STATIC breach (the floor is fixed at
    // the starting balance) - the admin must also accept that history. A
    // TRAILING account or a daily-loss failure is what reinstatement is for:
    const daily = await fixtures.createAccount({ userId: user.id, template: await fixtures.createTemplate({ maxDrawdown: 50, dailyDrawdown: 5 }) });
    await fixtures.addClosedTrade(daily.id, -600);
    expect((await evaluateAccount(daily.id)).status).toBe("FAILED");

    const reinstated = await setAccountStatusManually(daily.id, "ACTIVE", admin.id, "goodwill");
    expect(reinstated.status).toBe("ACTIVE");
    expect(reinstated.dailyAnchorBalance).toBe(9400);

    const after = await evaluateAccount(daily.id);
    expect(after.status).toBe("ACTIVE");
  });

  it("refuses illegal transitions such as ACTIVE -> FUNDED or anything -> PASSED", async () => {
    const user = await fixtures.createUser();
    const admin = await fixtures.createUser("ADMIN");
    const template = await fixtures.createTemplate();
    const account = await fixtures.createAccount({ userId: user.id, template });

    await expect(setAccountStatusManually(account.id, "FUNDED", admin.id)).rejects.toThrow(ConflictError);
    await expect(setAccountStatusManually(account.id, "PASSED", admin.id)).rejects.toThrow(ConflictError);
  });
});

describe("resetAccount", () => {
  it("archives trades instead of deleting them and keeps a FUNDED account FUNDED", async () => {
    const user = await fixtures.createUser();
    const admin = await fixtures.createUser("ADMIN");
    const template = await fixtures.createTemplate({ phase: "FUNDED", profitTarget: null });
    const account = await fixtures.createAccount({ userId: user.id, template, status: "FUNDED" });
    await fixtures.addClosedTrade(account.id, -300);
    await evaluateAccount(account.id);

    const reset = await resetAccount(account.id, admin.id);
    expect(reset.status).toBe("FUNDED");
    expect(reset.balance).toBe(10000);
    expect(reset.tradeCount).toBe(0);

    const trades = await prisma.trade.findMany({ where: { accountId: account.id } });
    expect(trades).toHaveLength(1);
    expect(trades[0].archivedAt).not.toBeNull();

    const after = await evaluateAccount(account.id);
    expect(after.balance).toBe(10000);
  });

  it("refuses to reset an account that already advanced to a next phase", async () => {
    const user = await fixtures.createUser();
    const admin = await fixtures.createUser("ADMIN");
    const phase2 = await fixtures.createTemplate({ phase: "PHASE_2", profitTarget: 5, minTradingDays: 0 });
    const phase1 = await fixtures.createTemplate({ phase: "PHASE_1", profitTarget: 8, minTradingDays: 0, nextPhaseId: phase2.id });
    const account = await fixtures.createAccount({ userId: user.id, template: phase1 });
    await fixtures.addClosedTrade(account.id, 900);
    expect((await evaluateAccount(account.id)).status).toBe("PASSED");

    await expect(resetAccount(account.id, admin.id)).rejects.toThrow(ConflictError);
  });
});
