import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { activatePurchase, cancelPurchase, initiateChapaPurchase, refundPurchase, verifyAndCompleteChapaPurchase } from "@/lib/services/purchases";
import {
  attachReferral,
  decideReferralReward,
  getOrCreateReferralCode,
  getReferralCommissionPercent,
  getReferralOverview,
  REFERRAL_COMMISSION_SETTING,
  setReferralCommissionPercent,
} from "@/lib/services/referrals";
import { AuthError, ConflictError } from "@/lib/errors";
import { TestFixtures } from "./helpers/fixtures";

vi.mock("@/lib/services/chapa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/chapa")>();
  return { ...actual, initializeChapaTransaction: vi.fn(), verifyChapaTransaction: vi.fn() };
});

import { initializeChapaTransaction, verifyChapaTransaction } from "@/lib/services/chapa";

const mockInitialize = vi.mocked(initializeChapaTransaction);
const mockVerify = vi.mocked(verifyChapaTransaction);

const fixtures = new TestFixtures();
const couponIds: string[] = [];
let savedSetting: { value: unknown } | null = null;

beforeEach(async () => {
  mockInitialize.mockReset();
  mockVerify.mockReset();
  mockInitialize.mockResolvedValue({ checkoutUrl: "https://checkout.chapa.co/checkout/payment/mock" });
  savedSetting = await prisma.systemSetting.findUnique({ where: { key: REFERRAL_COMMISSION_SETTING } });
  await prisma.systemSetting.deleteMany({ where: { key: REFERRAL_COMMISSION_SETTING } });
});

afterEach(async () => {
  await fixtures.cleanup();
  if (couponIds.length > 0) await prisma.coupon.deleteMany({ where: { id: { in: couponIds.splice(0) } } });
  await prisma.systemSetting.deleteMany({ where: { key: REFERRAL_COMMISSION_SETTING } });
  if (savedSetting) await prisma.systemSetting.create({ data: { key: REFERRAL_COMMISSION_SETTING, value: savedSetting.value as never } });
});

function trader(user: { id: string; name: string; email: string }) {
  return { id: user.id, name: user.name, email: user.email };
}

/** A referrer with a code and a buyer attached to them. */
async function referredPair() {
  const referrer = await fixtures.createUser();
  const buyer = await fixtures.createUser();
  const code = await getOrCreateReferralCode(referrer.id);
  await attachReferral(buyer.id, code);
  return { referrer, buyer, code };
}

/** Initiates and verifies a real (mocked-Chapa) purchase, returning the PAID purchase. */
async function buyAndPay(user: { id: string; name: string; email: string }, templateId: string, couponCode?: string) {
  const initiated = await initiateChapaPurchase(trader(user), templateId, undefined, { couponCode });
  const purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: initiated.purchaseId } });
  if (purchase.status !== "PAID") {
    mockVerify.mockResolvedValueOnce({ paymentStatus: "success", amount: purchase.amount, currency: "ETB", txRef: purchase.providerTxRef });
    await verifyAndCompleteChapaPurchase(purchase.providerTxRef);
  }
  return prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
}

describe("referral codes and attachment", () => {
  it("assigns a stable 8-character code on first use", async () => {
    const user = await fixtures.createUser();
    const code = await getOrCreateReferralCode(user.id);
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
    expect(await getOrCreateReferralCode(user.id)).toBe(code);
    const [a, b] = await Promise.all([getOrCreateReferralCode((await fixtures.createUser()).id), getOrCreateReferralCode(user.id)]);
    expect(b).toBe(code);
    expect(a).not.toBe(code);
  });

  it("attaches a new user to the referrer (case-insensitive) exactly once", async () => {
    const referrer = await fixtures.createUser();
    const other = await fixtures.createUser();
    const buyer = await fixtures.createUser();
    const code = await getOrCreateReferralCode(referrer.id);
    const otherCode = await getOrCreateReferralCode(other.id);

    await attachReferral(buyer.id, code.toLowerCase());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).referredById).toBe(referrer.id);

    // Never overwrites an existing referrer.
    await attachReferral(buyer.id, otherCode);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).referredById).toBe(referrer.id);
  });

  it("ignores unknown, malformed and self-referral codes and never throws", async () => {
    const user = await fixtures.createUser();
    const ownCode = await getOrCreateReferralCode(user.id);

    await expect(attachReferral(user.id, ownCode)).resolves.toBeUndefined();
    await expect(attachReferral(user.id, "ZZZZZZZZ")).resolves.toBeUndefined();
    await expect(attachReferral(user.id, "'; DROP TABLE")).resolves.toBeUndefined();
    await expect(attachReferral(user.id, null)).resolves.toBeUndefined();
    await expect(attachReferral("no-such-user", ownCode)).resolves.toBeUndefined();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).referredById).toBeNull();
  });

  it("ignores a disabled referrer", async () => {
    const referrer = await fixtures.createUser();
    const buyer = await fixtures.createUser();
    const code = await getOrCreateReferralCode(referrer.id);
    await prisma.user.update({ where: { id: referrer.id }, data: { status: "DISABLED" } });
    await attachReferral(buyer.id, code);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: buyer.id } })).referredById).toBeNull();
  });
});

describe("referral rewards", () => {
  it("creates one PENDING reward of the commission on the amount actually paid (after coupon) and notifies the referrer", async () => {
    const { referrer, buyer } = await referredPair();
    const template = await fixtures.createTemplate({ price: 2000 });
    const coupon = await prisma.coupon.create({ data: { code: `VTREF${Date.now().toString(36).toUpperCase()}`, percentOff: 25 } });
    couponIds.push(coupon.id);

    const purchase = await buyAndPay(buyer, template.id, coupon.code);
    expect(purchase.amount).toBe(1500);

    const rewards = await prisma.referralReward.findMany({ where: { referrerId: referrer.id } });
    expect(rewards).toHaveLength(1);
    expect(rewards[0]).toMatchObject({ status: "PENDING", percent: 10, amount: 150, purchaseId: purchase.id, referredUserId: buyer.id });
    expect(await prisma.notification.count({ where: { userId: referrer.id, link: "/referrals" } })).toBe(1);

    // Re-running activation (webhook + callback) does not create a second reward.
    await activatePurchase(purchase.id, { source: "CHAPA" });
    expect(await prisma.referralReward.count({ where: { referrerId: referrer.id } })).toBe(1);
  });

  it("uses the configured commission percent and validates its range", async () => {
    const admin = await fixtures.createUser("ADMIN");
    const { referrer, buyer } = await referredPair();
    const template = await fixtures.createTemplate({ price: 1000 });

    expect(await getReferralCommissionPercent()).toBe(10);
    await expect(setReferralCommissionPercent(51, admin.id)).rejects.toBeInstanceOf(ConflictError);
    await setReferralCommissionPercent(20, admin.id);
    expect(await prisma.auditLog.count({ where: { action: "SETTING_UPDATED", targetId: REFERRAL_COMMISSION_SETTING, actorId: admin.id } })).toBe(1);

    await buyAndPay(buyer, template.id);
    const reward = await prisma.referralReward.findFirstOrThrow({ where: { referrerId: referrer.id } });
    expect(reward).toMatchObject({ percent: 20, amount: 200 });
  });

  it("creates no reward for unreferred buyers, free purchases or admin test activations", async () => {
    const admin = await fixtures.createUser("ADMIN");
    const { referrer, buyer } = await referredPair();
    const loner = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 1000 });
    const free = await prisma.coupon.create({ data: { code: `VTFREE${Date.now().toString(36).toUpperCase()}`, percentOff: 100, perUserLimit: 5 } });
    couponIds.push(free.id);

    await buyAndPay(loner, template.id);
    await buyAndPay(buyer, template.id, free.code);
    const pending = await initiateChapaPurchase(trader(buyer), template.id);
    await activatePurchase(pending.purchaseId, { source: "ADMIN_TEST", adminId: admin.id });

    expect(await prisma.referralReward.count({ where: { OR: [{ referrerId: referrer.id }, { referredUserId: loner.id }] } })).toBe(0);
  });

  it("voids an unpaid reward when the purchase is refunded or cancelled", async () => {
    const admin = await fixtures.createUser("ADMIN");
    const { referrer, buyer } = await referredPair();
    const template = await fixtures.createTemplate({ price: 1000 });

    const refunded = await buyAndPay(buyer, template.id);
    const cancelled = await buyAndPay(buyer, template.id);
    const approved = await prisma.referralReward.findUniqueOrThrow({ where: { purchaseId: cancelled.id } });
    await decideReferralReward(approved.id, "APPROVE", admin.id);

    await refundPurchase(refunded.id, admin.id);
    await cancelPurchase(cancelled.id, admin.id);

    const rewards = await prisma.referralReward.findMany({ where: { referrerId: referrer.id } });
    expect(rewards.map((r) => r.status)).toEqual(["VOID", "VOID"]);
    expect(rewards.every((r) => r.voidedAt)).toBe(true);
  });

  it("keeps an already-PAID reward PAID (flagged) when the purchase is refunded later", async () => {
    const [approver, payer] = [await fixtures.createUser("ADMIN"), await fixtures.createUser("ADMIN")];
    const { buyer } = await referredPair();
    const template = await fixtures.createTemplate({ price: 1000 });
    const purchase = await buyAndPay(buyer, template.id);
    const reward = await prisma.referralReward.findUniqueOrThrow({ where: { purchaseId: purchase.id } });
    await decideReferralReward(reward.id, "APPROVE", approver.id);
    await decideReferralReward(reward.id, "PAY", payer.id, { providerRef: "TB123" });

    await refundPurchase(purchase.id, approver.id);

    const after = await prisma.referralReward.findUniqueOrThrow({ where: { id: reward.id } });
    expect(after.status).toBe("PAID");
    expect(after.note).toMatch(/PURCHASE_REFUNDED after the reward was paid/);
    expect(await prisma.auditLog.count({ where: { action: "REFERRAL_REWARD_PAID_BUT_PURCHASE_REVERSED", targetId: reward.id } })).toBe(1);
  });
});

describe("referral reward payout (maker-checker)", () => {
  async function pendingReward() {
    const { referrer, buyer } = await referredPair();
    const template = await fixtures.createTemplate({ price: 3000 });
    const purchase = await buyAndPay(buyer, template.id);
    return { referrer, reward: await prisma.referralReward.findUniqueOrThrow({ where: { purchaseId: purchase.id } }) };
  }

  it("requires approval, then a different admin to mark it paid; records the ledger debit and audit trail", async () => {
    const [approver, payer] = [await fixtures.createUser("ADMIN"), await fixtures.createUser("ADMIN")];
    const { referrer, reward } = await pendingReward();

    await expect(decideReferralReward(reward.id, "PAY", payer.id)).rejects.toThrow(/approved before/);
    await decideReferralReward(reward.id, "APPROVE", approver.id);
    await expect(decideReferralReward(reward.id, "APPROVE", payer.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(decideReferralReward(reward.id, "PAY", approver.id)).rejects.toBeInstanceOf(AuthError);

    const paid = await decideReferralReward(reward.id, "PAY", payer.id, { providerRef: "TELEBIRR-777", note: "sent" });
    expect(paid).toMatchObject({ status: "PAID", approvedById: approver.id, paidById: payer.id });
    expect(paid.note).toContain("TELEBIRR-777");

    const ledger = await prisma.ledgerEntry.findMany({ where: { refType: "ReferralReward", refId: reward.id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ userId: referrer.id, amount: -300, type: "ADJUSTMENT" });
    const actions = (await prisma.auditLog.findMany({ where: { targetType: "ReferralReward", targetId: reward.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["REFERRAL_REWARD_APPROVED", "REFERRAL_REWARD_PAID"]);

    await expect(decideReferralReward(reward.id, "VOID", approver.id, { note: "late" })).rejects.toBeInstanceOf(ConflictError);
    await prisma.auditLog.deleteMany({ where: { targetType: "ReferralReward", targetId: reward.id } });
  });

  it("applies a transition only once under concurrent clicks", async () => {
    const [a, b] = [await fixtures.createUser("ADMIN"), await fixtures.createUser("ADMIN")];
    const { reward } = await pendingReward();
    const results = await Promise.allSettled([decideReferralReward(reward.id, "APPROVE", a.id), decideReferralReward(reward.id, "APPROVE", b.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await prisma.auditLog.deleteMany({ where: { targetType: "ReferralReward", targetId: reward.id } });
  });

  it("requires a reason to void and forbids deciding your own reward", async () => {
    const admin = await fixtures.createUser("ADMIN");
    const { referrer, reward } = await pendingReward();
    await expect(decideReferralReward(reward.id, "VOID", admin.id)).rejects.toThrow(/reason/);
    await expect(decideReferralReward(reward.id, "APPROVE", referrer.id)).rejects.toBeInstanceOf(AuthError);
    const voided = await decideReferralReward(reward.id, "VOID", admin.id, { note: "self-referral ring" });
    expect(voided.status).toBe("VOID");
    expect(voided.note).toContain("self-referral ring");
    await prisma.auditLog.deleteMany({ where: { targetType: "ReferralReward", targetId: reward.id } });
  });

  it("summarises a trader's referrals with masked names", async () => {
    const [approver, payer] = [await fixtures.createUser("ADMIN"), await fixtures.createUser("ADMIN")];
    const { referrer, buyer } = await referredPair();
    await prisma.user.update({ where: { id: buyer.id }, data: { name: "Abebe Kebede" } });
    await attachReferral((await fixtures.createUser()).id, await getOrCreateReferralCode(referrer.id)); // signed up, never bought
    const template = await fixtures.createTemplate({ price: 1000 });
    await buyAndPay(buyer, template.id);
    const second = await buyAndPay(buyer, template.id);
    const reward = await prisma.referralReward.findUniqueOrThrow({ where: { purchaseId: second.id } });
    await decideReferralReward(reward.id, "APPROVE", approver.id);
    await decideReferralReward(reward.id, "PAY", payer.id);

    const overview = await getReferralOverview(referrer.id);
    expect(overview).toMatchObject({ signups: 2, payingReferrals: 1, percent: 10, earnings: { pending: 100, approved: 0, paid: 100 } });
    expect(overview.rewards.map((r) => r.referredName)).toEqual(["Abebe K.", "Abebe K."]);
    expect(JSON.stringify(overview)).not.toContain(buyer.email);
    await prisma.auditLog.deleteMany({ where: { targetType: "ReferralReward", targetId: reward.id } });
  });
});
