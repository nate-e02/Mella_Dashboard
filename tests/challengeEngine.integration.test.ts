import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { evaluateAccount } from "@/lib/services/challengeEngine";
import { TestFixtures } from "./helpers/fixtures";

/**
 * These tests exercise the real challenge engine against the local Postgres
 * database (the same one `npm run dev` uses) - the state-machine decision
 * logic itself is covered by the pure-function unit tests in
 * challengeRules.test.ts; what matters here is the database side: does
 * evaluateAccount() actually persist the right thing, exactly once, even
 * under concurrent evaluation.
 */

const fixtures = new TestFixtures();
afterEach(() => fixtures.cleanup());

describe("evaluateAccount", () => {
  it("leaves an account with no trades ACTIVE with unchanged balance/equity", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();
    const account = await fixtures.createAccount({ userId: user.id, template });

    const result = await evaluateAccount(account.id);

    expect(result.status).toBe("ACTIVE");
    expect(result.balance).toBe(10000);
    expect(result.equity).toBe(10000);
  });

  it("transitions ACTIVE -> FAILED on a losing trade that breaches max drawdown", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ maxDrawdown: 10, dailyDrawdown: 50 }); // isolate overall DD
    const account = await fixtures.createAccount({ userId: user.id, template });
    await fixtures.addClosedTrade(account.id, -1200); // 12% loss on a 10% limit

    const result = await evaluateAccount(account.id);

    expect(result.status).toBe("FAILED");
    expect(result.failedAt).not.toBeNull();
  });

  it("transitions ACTIVE -> PASSED and creates exactly one next-phase account", async () => {
    const user = await fixtures.createUser();
    const phase2 = await fixtures.createTemplate({ phase: "PHASE_2", profitTarget: 5, minTradingDays: 0 });
    const phase1 = await fixtures.createTemplate({ phase: "PHASE_1", profitTarget: 8, minTradingDays: 0, nextPhaseId: phase2.id });
    const account = await fixtures.createAccount({ userId: user.id, template: phase1 });
    await fixtures.addClosedTrade(account.id, 900); // 9% > 8% target

    const result = await evaluateAccount(account.id);

    expect(result.status).toBe("PASSED");
    const nextAccounts = await fixtures.findAccountsByPreviousId(account.id);
    expect(nextAccounts).toHaveLength(1);
    expect(nextAccounts[0].phase).toBe("PHASE_2");
    expect(nextAccounts[0].status).toBe("ACTIVE");
    expect(nextAccounts[0].startingBalance).toBe(phase2.startingBalance);
  });

  it("advances a passed Phase 2 account straight to a FUNDED account", async () => {
    const user = await fixtures.createUser();
    const funded = await fixtures.createTemplate({ phase: "FUNDED", profitTarget: null });
    const phase2 = await fixtures.createTemplate({ phase: "PHASE_2", profitTarget: 5, minTradingDays: 0, nextPhaseId: funded.id });
    const account = await fixtures.createAccount({ userId: user.id, template: phase2 });
    await fixtures.addClosedTrade(account.id, 600); // 6% > 5% target

    await evaluateAccount(account.id);

    const nextAccounts = await fixtures.findAccountsByPreviousId(account.id);
    expect(nextAccounts).toHaveLength(1);
    expect(nextAccounts[0].phase).toBe("FUNDED");
    expect(nextAccounts[0].status).toBe("FUNDED");
    expect(nextAccounts[0].fundedAt).not.toBeNull();
  });

  it("passes a final-phase account with no nextPhaseId without creating a follow-on account or crashing", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ profitTarget: 8, minTradingDays: 0 }); // no nextPhaseId set
    const account = await fixtures.createAccount({ userId: user.id, template });
    await fixtures.addClosedTrade(account.id, 900);

    const result = await evaluateAccount(account.id);

    expect(result.status).toBe("PASSED");
    const nextAccounts = await fixtures.findAccountsByPreviousId(account.id);
    expect(nextAccounts).toHaveLength(0);
  });

  // Note: a Template with a `nextPhaseId` pointing at a template that
  // doesn't exist can't actually be constructed - `Template.nextPhaseId`
  // has a real foreign-key constraint, so the database itself rejects that
  // insert (confirmed by attempting it here previously). Combined with
  // deleteOrArchiveTemplate() refusing to hard-delete a template that's
  // still referenced by another template's nextPhaseId, a "dangling"
  // nextPhaseId is not reachable through the application. evaluateAccount's
  // `if (!nextTemplate) return` guard is kept anyway as defense in depth.

  it("never re-decides an already PASSED account, even with new losing trades added", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ profitTarget: 8, minTradingDays: 0 });
    const account = await fixtures.createAccount({ userId: user.id, template, status: "PASSED", balance: 10800, equity: 10800, highWaterMark: 10800 });
    await fixtures.addClosedTrade(account.id, -5000); // would clearly breach drawdown if re-evaluated

    const result = await evaluateAccount(account.id);

    expect(result.status).toBe("PASSED");
  });

  it("never re-decides an already FAILED account, even with new winning trades added", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ profitTarget: 8, minTradingDays: 0 });
    const account = await fixtures.createAccount({ userId: user.id, template, status: "FAILED", balance: 9000, equity: 9000 });
    await fixtures.addClosedTrade(account.id, 5000); // would clearly hit target if re-evaluated

    const result = await evaluateAccount(account.id);

    expect(result.status).toBe("FAILED");
  });

  it("repeated evaluation of the same passing account does not duplicate the next-phase account", async () => {
    const user = await fixtures.createUser();
    const phase2 = await fixtures.createTemplate({ phase: "PHASE_2" });
    const phase1 = await fixtures.createTemplate({ profitTarget: 8, minTradingDays: 0, nextPhaseId: phase2.id });
    const account = await fixtures.createAccount({ userId: user.id, template: phase1 });
    await fixtures.addClosedTrade(account.id, 900);

    // Evaluate the same account five times in a row, as the task's own
    // example describes - this must never create more than one Phase 2
    // account.
    for (let i = 0; i < 5; i++) {
      await evaluateAccount(account.id);
    }

    const nextAccounts = await fixtures.findAccountsByPreviousId(account.id);
    expect(nextAccounts).toHaveLength(1);
  });

  it("does not create duplicate next-phase accounts when two evaluations race concurrently", async () => {
    const user = await fixtures.createUser();
    const phase2 = await fixtures.createTemplate({ phase: "PHASE_2" });
    const phase1 = await fixtures.createTemplate({ profitTarget: 8, minTradingDays: 0, nextPhaseId: phase2.id });
    const account = await fixtures.createAccount({ userId: user.id, template: phase1 });
    await fixtures.addClosedTrade(account.id, 900);

    // Fire several concurrent evaluations of the same just-passed account -
    // this is the scenario an optimistic-concurrency bug would fail under
    // (e.g. two page loads, or a request racing a retry).
    const results = await Promise.allSettled([
      evaluateAccount(account.id),
      evaluateAccount(account.id),
      evaluateAccount(account.id),
      evaluateAccount(account.id),
    ]);

    for (const result of results) {
      expect(result.status).toBe("fulfilled");
    }

    const nextAccounts = await fixtures.findAccountsByPreviousId(account.id);
    expect(nextAccounts).toHaveLength(1);

    const finalAccount = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(finalAccount.status).toBe("PASSED");

    const transitionLogs = await prisma.auditLog.findMany({
      where: { targetType: "TradingAccount", targetId: account.id, action: "ACCOUNT_STATUS_AUTO_TRANSITION" },
    });
    // Exactly one of the concurrent evaluations should have "won" the
    // transition and logged it - the rest should have silently no-opped.
    expect(transitionLogs).toHaveLength(1);
  });

  it("does not create duplicate audit-log entries when two evaluations race a FAILED transition", async () => {
    // Mirrors the concurrent PASSED test above exactly, for the ACTIVE ->
    // FAILED path: the same compare-and-swap `updateMany` gate that guards
    // the audit-log write is not conditioned on which new status is being
    // written, so this must hold just as strongly as it does for PASSED.
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ maxDrawdown: 10, dailyDrawdown: 50 }); // isolate overall DD
    const account = await fixtures.createAccount({ userId: user.id, template });
    await fixtures.addClosedTrade(account.id, -1200); // 12% loss on a 10% limit

    const results = await Promise.allSettled([
      evaluateAccount(account.id),
      evaluateAccount(account.id),
      evaluateAccount(account.id),
      evaluateAccount(account.id),
    ]);

    for (const result of results) {
      expect(result.status).toBe("fulfilled");
    }

    const finalAccount = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(finalAccount.status).toBe("FAILED");

    const transitionLogs = await prisma.auditLog.findMany({
      where: { targetType: "TradingAccount", targetId: account.id, action: "ACCOUNT_STATUS_AUTO_TRANSITION" },
    });
    expect(transitionLogs).toHaveLength(1);

    // FAILED must never advance to a next-phase account.
    const nextAccounts = await fixtures.findAccountsByPreviousId(account.id);
    expect(nextAccounts).toHaveLength(0);
  });
});
