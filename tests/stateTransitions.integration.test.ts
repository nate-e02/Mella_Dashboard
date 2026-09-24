import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { refundPurchase, cancelPurchase } from "@/lib/services/purchases";
import { decideKyc } from "@/lib/services/kyc";
import { decidePayout, createPayout, computePayoutAvailability, MIN_PAYOUT_ETB } from "@/lib/services/payouts";
import { AuthError, ConflictError } from "@/lib/auth/guards";
import { TestFixtures } from "./helpers/fixtures";

const fixtures = new TestFixtures();
afterEach(() => fixtures.cleanup());

describe("invalid state transitions are rejected", () => {
  it("cannot refund a purchase twice", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();
    const { purchase } = await fixtures.createPaidPurchase({ userId: user.id, template });

    await refundPurchase(purchase.id, user.id);

    await expect(refundPurchase(purchase.id, user.id)).rejects.toThrow(ConflictError);
  });

  it("refunding a purchase suspends the trading account attached to it", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();
    const { purchase, account } = await fixtures.createPaidPurchase({ userId: user.id, template });

    await refundPurchase(purchase.id, user.id);

    const after = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.status).toBe("SUSPENDED");
    expect(after.failureReason).toBe("PURCHASE_REFUNDED");
  });

  it("cannot cancel a purchase that has already been refunded", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();
    const { purchase } = await fixtures.createPaidPurchase({ userId: user.id, template });

    await refundPurchase(purchase.id, user.id);

    await expect(cancelPurchase(purchase.id, user.id)).rejects.toThrow(ConflictError);
  });

  it("cannot decide the same KYC submission twice", async () => {
    const trader = await fixtures.createUser("TRADER");
    const admin = await fixtures.createUser("ADMIN");
    const submission = await prisma.kycSubmission.create({
      data: { userId: trader.id, fullName: "Test Trader", country: "Ethiopia", documentType: "Fayda ID", provider: "MANUAL" },
    });

    await decideKyc(submission.id, "APPROVED", undefined, admin.id);

    await expect(decideKyc(submission.id, "REJECTED", undefined, admin.id)).rejects.toThrow(ConflictError);

    const final = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(final.status).toBe("APPROVED"); // unchanged by the rejected second decision
  });
});

async function fundedAccountWithProfit(profit: number, opts: { kyc?: boolean; fundedDaysAgo?: number } = {}) {
  const trader = await fixtures.createUser("TRADER");
  const template = await fixtures.createTemplate({ phase: "FUNDED", profitTarget: null, profitSplit: 80 });
  const account = await fixtures.createAccount({ userId: trader.id, template, status: "FUNDED", balance: 10000 + profit, equity: 10000 + profit, highWaterMark: 10000 + Math.max(0, profit) });
  await prisma.tradingAccount.update({
    where: { id: account.id },
    data: { realizedPnl: profit, fundedAt: new Date(Date.now() - (opts.fundedDaysAgo ?? 30) * 86_400_000) },
  });
  if (opts.kyc !== false) {
    await prisma.kycSubmission.create({ data: { userId: trader.id, status: "APPROVED", provider: "MANUAL", reviewedAt: new Date() } });
  }
  return { trader, account };
}

describe("payouts - eligibility", () => {
  it("computes the available amount as (profit x split) minus payouts already requested", async () => {
    const { account } = await fundedAccountWithProfit(5000);
    const before = await computePayoutAvailability(account.id);
    expect(before.traderShare).toBe(4000);
    expect(before.available).toBe(4000);
    expect(before.eligible).toBe(true);

    const admin = await fixtures.createUser("ADMIN");
    await createPayout({ tradingAccountId: account.id, amount: 1500, requestedByUserId: admin.id, byAdmin: true });

    const after = await computePayoutAvailability(account.id);
    expect(after.alreadyCommitted).toBe(1500);
    expect(after.available).toBe(2500);
  });

  it("rejects a payout above the available profit share", async () => {
    const { account } = await fundedAccountWithProfit(1000);
    const admin = await fixtures.createUser("ADMIN");
    await expect(createPayout({ tradingAccountId: account.id, amount: 900, requestedByUserId: admin.id, byAdmin: true })).rejects.toThrow(ConflictError);
  });

  it("rejects a payout below the minimum, without KYC, on a non-funded account, or before the funded waiting period", async () => {
    const admin = await fixtures.createUser("ADMIN");

    const tooSmall = await fundedAccountWithProfit(5000);
    await expect(createPayout({ tradingAccountId: tooSmall.account.id, amount: MIN_PAYOUT_ETB - 1, requestedByUserId: admin.id, byAdmin: true })).rejects.toThrow(ConflictError);

    const noKyc = await fundedAccountWithProfit(5000, { kyc: false });
    await expect(createPayout({ tradingAccountId: noKyc.account.id, amount: 1000, requestedByUserId: admin.id, byAdmin: true })).rejects.toThrow(/KYC/);

    const tooEarly = await fundedAccountWithProfit(5000, { fundedDaysAgo: 3 });
    await expect(createPayout({ tradingAccountId: tooEarly.account.id, amount: 1000, requestedByUserId: admin.id, byAdmin: true })).rejects.toThrow(/days after funding/);

    const trader = await fixtures.createUser("TRADER");
    const template = await fixtures.createTemplate();
    const active = await fixtures.createAccount({ userId: trader.id, template, balance: 15000 });
    await prisma.kycSubmission.create({ data: { userId: trader.id, status: "APPROVED", provider: "MANUAL" } });
    await expect(createPayout({ tradingAccountId: active.id, amount: 1000, requestedByUserId: admin.id, byAdmin: true })).rejects.toThrow(/funded accounts/);
  });

  it("a trader can only request payouts on their own account", async () => {
    const { account } = await fundedAccountWithProfit(5000);
    const other = await fixtures.createUser("TRADER");
    await expect(createPayout({ tradingAccountId: account.id, amount: 1000, requestedByUserId: other.id })).rejects.toThrow(AuthError);
  });
});

describe("payouts - maker-checker state machine", () => {
  it("requires a different admin to approve and a third to pay, debits the account when paid, and refuses re-deciding", async () => {
    const { account } = await fundedAccountWithProfit(5000);
    const creator = await fixtures.createUser("ADMIN");
    const approver = await fixtures.createUser("ADMIN");
    const payer = await fixtures.createUser("ADMIN");

    const payout = await createPayout({ tradingAccountId: account.id, amount: 2000, requestedByUserId: creator.id, byAdmin: true });
    expect(payout.status).toBe("PENDING");

    // Creator cannot approve their own request.
    await expect(decidePayout(payout.id, "APPROVED", creator.id)).rejects.toThrow(AuthError);
    // Cannot skip straight to PAID.
    await expect(decidePayout(payout.id, "PAID", approver.id)).rejects.toThrow(ConflictError);

    const approved = await decidePayout(payout.id, "APPROVED", approver.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedById).toBe(approver.id);

    // Approver cannot also mark it paid.
    await expect(decidePayout(payout.id, "PAID", approver.id)).rejects.toThrow(AuthError);

    const anchorBefore = (await prisma.tradingAccount.findUniqueOrThrow({ where: { id: account.id } })).dailyAnchorBalance;
    const paid = await decidePayout(payout.id, "PAID", payer.id, { providerRef: "chapa-transfer-1" });
    expect(paid.status).toBe("PAID");
    expect(paid.paidById).toBe(payer.id);

    // Paying 2000 at an 80% split consumes 2500 of profit (500 is the firm's share).
    const after = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.balance).toBe(12500);
    expect(after.dailyAnchorBalance).toBe(anchorBefore - 2500); // anchor shifted: the payout is not a daily loss
    const { evaluateAccount } = await import("@/lib/services/challengeEngine");
    expect((await evaluateAccount(account.id)).status).toBe("FUNDED");
    const ledger = await prisma.ledgerEntry.findFirst({ where: { refType: "Payout", refId: payout.id, type: "PAYOUT" } });
    expect(ledger?.amount).toBe(-2000);
    const firm = await prisma.ledgerEntry.findFirst({ where: { refType: "PayoutFirmShare", refId: payout.id } });
    expect(firm?.amount).toBe(-500);
    // Availability drops by exactly the amount paid: 4000 share - 2000 paid = 2000.
    expect((await computePayoutAvailability(account.id)).available).toBe(2000);

    await expect(decidePayout(payout.id, "REJECTED", approver.id)).rejects.toThrow(ConflictError);
  });

  it("only one of two concurrent approvals wins", async () => {
    const { account } = await fundedAccountWithProfit(5000);
    const creator = await fixtures.createUser("ADMIN");
    const a = await fixtures.createUser("ADMIN");
    const b = await fixtures.createUser("ADMIN");
    const payout = await createPayout({ tradingAccountId: account.id, amount: 1000, requestedByUserId: creator.id, byAdmin: true });

    const results = await Promise.allSettled([decidePayout(payout.id, "APPROVED", a.id), decidePayout(payout.id, "APPROVED", b.id)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    const logs = await prisma.auditLog.count({ where: { targetType: "Payout", targetId: payout.id, action: "PAYOUT_APPROVED" } });
    expect(logs).toBe(1);
  });
});
