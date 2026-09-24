import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { activatePurchase, initiateChapaPurchase, verifyAndCompleteChapaPurchase } from "@/lib/services/purchases";
import { CouponError, createCoupon, updateCoupon, validateCoupon, type CouponInput } from "@/lib/services/coupons";
import { TestFixtures } from "./helpers/fixtures";

// Chapa is mocked at the service-module boundary, as in purchases.integration.test.ts.
vi.mock("@/lib/services/chapa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/chapa")>();
  return { ...actual, initializeChapaTransaction: vi.fn(), verifyChapaTransaction: vi.fn() };
});

import { initializeChapaTransaction, verifyChapaTransaction } from "@/lib/services/chapa";

const mockInitialize = vi.mocked(initializeChapaTransaction);
const mockVerify = vi.mocked(verifyChapaTransaction);

const fixtures = new TestFixtures();
const couponIds: string[] = [];

beforeEach(() => {
  mockInitialize.mockReset();
  mockVerify.mockReset();
  mockInitialize.mockResolvedValue({ checkoutUrl: "https://checkout.chapa.co/checkout/payment/mock" });
});

afterEach(async () => {
  await fixtures.cleanup();
  if (couponIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { targetType: "Coupon", targetId: { in: couponIds } } });
    await prisma.coupon.deleteMany({ where: { id: { in: couponIds.splice(0) } } });
  }
});

function uniqueCode(prefix = "VT") {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

async function makeCoupon(overrides: Partial<Parameters<typeof prisma.coupon.create>[0]["data"]> = {}) {
  const coupon = await prisma.coupon.create({ data: { code: uniqueCode(), percentOff: 10, ...overrides } });
  couponIds.push(coupon.id);
  return coupon;
}

function trader(user: { id: string; name: string; email: string }) {
  return { id: user.id, name: user.name, email: user.email };
}

function chapaSuccess(txRef: string, amount: number) {
  return { paymentStatus: "success" as const, amount, currency: "ETB", txRef };
}

describe("validateCoupon", () => {
  it("prices a valid percentage coupon against the template's database price", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 2500 });
    const coupon = await makeCoupon({ percentOff: 10 });

    const result = await validateCoupon({ code: coupon.code.toLowerCase(), templateId: template.id, userId: user.id });

    expect(result).toMatchObject({ ok: true, listPrice: 2500, discount: 250, finalAmount: 2250 });
  });

  it("returns a specific reason for each way a coupon can be unusable", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 1000 });
    const other = await fixtures.createTemplate({ price: 1000 });
    const hour = 3_600_000;

    const cases: [string, Promise<{ code: string }> | { code: string }][] = [
      ["NOT_FOUND", { code: uniqueCode("NOPE") }],
      ["INACTIVE", makeCoupon({ active: false })],
      ["NOT_STARTED", makeCoupon({ validFrom: new Date(Date.now() + hour) })],
      ["EXPIRED", makeCoupon({ validUntil: new Date(Date.now() - hour) })],
      ["EXHAUSTED", makeCoupon({ maxRedemptions: 3, redeemedCount: 3 })],
      ["NOT_APPLICABLE", makeCoupon({ templateIds: [other.id] })],
    ];
    for (const [reason, pending] of cases) {
      const { code } = await pending;
      const result = await validateCoupon({ code, templateId: template.id, userId: user.id });
      expect(result, reason).toMatchObject({ ok: false, reason });
    }

    const malformed = await validateCoupon({ code: "no spaces allowed", templateId: template.id, userId: user.id });
    expect(malformed).toMatchObject({ ok: false, reason: "NOT_FOUND" });
  });

  it("counts PAID and recent PENDING uses towards the per-user limit, but not old PENDING or FAILED ones", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 1000 });
    const coupon = await makeCoupon({ perUserLimit: 1 });
    const base = { userId: user.id, templateId: template.id, currency: "ETB", snapshot: {}, couponId: coupon.id, amount: 900, listPrice: 1000, discountAmount: 100 };

    await prisma.purchase.create({ data: { ...base, status: "FAILED", providerTxRef: uniqueCode("tx") } });
    await prisma.purchase.create({ data: { ...base, status: "PENDING", providerTxRef: uniqueCode("tx"), createdAt: new Date(Date.now() - 2 * 3_600_000) } });
    expect(await validateCoupon({ code: coupon.code, templateId: template.id, userId: user.id })).toMatchObject({ ok: true });

    const recent = await prisma.purchase.create({ data: { ...base, status: "PENDING", providerTxRef: uniqueCode("tx") } });
    expect(await validateCoupon({ code: coupon.code, templateId: template.id, userId: user.id })).toMatchObject({ ok: false, reason: "USER_LIMIT" });
    // ...except when re-validating that very attempt
    expect(await validateCoupon({ code: coupon.code, templateId: template.id, userId: user.id, excludePurchaseId: recent.id })).toMatchObject({ ok: true });

    await prisma.purchase.update({ where: { id: recent.id }, data: { status: "PAID" } });
    expect(await validateCoupon({ code: coupon.code, templateId: template.id, userId: user.id })).toMatchObject({ ok: false, reason: "USER_LIMIT" });

    // Another user is unaffected.
    const other = await fixtures.createUser();
    expect(await validateCoupon({ code: coupon.code, templateId: template.id, userId: other.id })).toMatchObject({ ok: true });
  });
});

describe("checkout with a coupon", () => {
  it("charges Chapa exactly the discounted amount and records list price, discount and coupon", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 2500 });
    const coupon = await makeCoupon({ amountOff: 300, percentOff: null });

    const result = await initiateChapaPurchase(trader(user), template.id, undefined, { couponCode: coupon.code });

    expect(result.outcome).toBe("REDIRECT");
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockInitialize.mock.calls[0][0].amount).toBe(2200);
    const purchase = await prisma.purchase.findFirstOrThrow({ where: { userId: user.id } });
    expect(purchase).toMatchObject({ amount: 2200, listPrice: 2500, discountAmount: 300, couponId: coupon.id, status: "PENDING" });
    // Not redeemed until paid.
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).redeemedCount).toBe(0);

    mockVerify.mockResolvedValueOnce(chapaSuccess(purchase.providerTxRef, 2200));
    expect(await verifyAndCompleteChapaPurchase(purchase.providerTxRef)).toMatchObject({ outcome: "PAID" });
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).redeemedCount).toBe(1);
    const ledger = await prisma.ledgerEntry.findFirstOrThrow({ where: { purchaseId: purchase.id, type: "PURCHASE" } });
    expect(ledger.amount).toBe(2200);
  });

  it("refuses to activate when Chapa reports the undiscounted list price instead of the charged amount", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 2500 });
    const coupon = await makeCoupon({ percentOff: 20 });
    await initiateChapaPurchase(trader(user), template.id, undefined, { couponCode: coupon.code });
    const purchase = await prisma.purchase.findFirstOrThrow({ where: { userId: user.id } });

    mockVerify.mockResolvedValueOnce(chapaSuccess(purchase.providerTxRef, 2500));
    expect(await verifyAndCompleteChapaPurchase(purchase.providerTxRef)).toMatchObject({ outcome: "FAILED" });
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).redeemedCount).toBe(0);
  });

  it("rejects an invalid coupon without creating a purchase or calling Chapa", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 2500 });
    const coupon = await makeCoupon({ active: false });

    const err = await initiateChapaPurchase(trader(user), template.id, undefined, { couponCode: coupon.code }).catch((e) => e);
    expect(err).toBeInstanceOf(CouponError);
    expect((err as CouponError).reason).toBe("INACTIVE");
    expect(mockInitialize).not.toHaveBeenCalled();
    expect(await prisma.purchase.count({ where: { userId: user.id } })).toBe(0);
  });

  it("keeps returning the same purchase (and quoted price) when the same attempt is retried", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 1000 });
    const coupon = await makeCoupon({ percentOff: 50 });
    const key = `coupon-retry-${Date.now()}`;

    const first = await initiateChapaPurchase(trader(user), template.id, key, { couponCode: coupon.code });
    // A retry without (or with a different) coupon code cannot re-price the attempt.
    const second = await initiateChapaPurchase(trader(user), template.id, key);

    expect(first.purchaseId).toBe(second.purchaseId);
    expect(await prisma.purchase.count({ where: { userId: user.id } })).toBe(1);
    expect(mockInitialize.mock.calls.map((c) => c[0].amount)).toEqual([500, 500]);
  });

  it("refuses to reopen a checkout whose coupon was deactivated meanwhile", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 1000 });
    const coupon = await makeCoupon({ percentOff: 50 });
    const key = `coupon-dead-${Date.now()}`;
    await initiateChapaPurchase(trader(user), template.id, key, { couponCode: coupon.code });
    await prisma.coupon.update({ where: { id: coupon.id }, data: { active: false } });

    await expect(initiateChapaPurchase(trader(user), template.id, key)).rejects.toBeInstanceOf(CouponError);
    expect((await prisma.purchase.findFirstOrThrow({ where: { userId: user.id } })).status).toBe("FAILED");
  });

  it("never refuses a Chapa-paid purchase after payment, even if the coupon ran out meanwhile (audited instead)", async () => {
    const [a, b] = [await fixtures.createUser(), await fixtures.createUser()];
    const template = await fixtures.createTemplate({ price: 1000 });
    const coupon = await makeCoupon({ percentOff: 10, maxRedemptions: 1 });

    await initiateChapaPurchase(trader(a), template.id, undefined, { couponCode: coupon.code });
    await initiateChapaPurchase(trader(b), template.id, undefined, { couponCode: coupon.code });
    const purchases = await prisma.purchase.findMany({ where: { couponId: coupon.id } });
    expect(purchases).toHaveLength(2);

    for (const p of purchases) {
      mockVerify.mockResolvedValueOnce(chapaSuccess(p.providerTxRef, 900));
      expect(await verifyAndCompleteChapaPurchase(p.providerTxRef)).toMatchObject({ outcome: "PAID" });
    }
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).redeemedCount).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "COUPON_OVER_REDEEMED", targetId: coupon.id } })).toBe(1);
  });
});

describe("free (100%) coupons", () => {
  it("activates immediately without calling Chapa", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 1500 });
    const coupon = await makeCoupon({ percentOff: 100, templateIds: [template.id] });

    const result = await initiateChapaPurchase(trader(user), template.id, `free-${Date.now()}`, { couponCode: coupon.code });

    expect(result.outcome).toBe("ACTIVATED");
    expect(mockInitialize).not.toHaveBeenCalled();
    expect(mockVerify).not.toHaveBeenCalled();
    const purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: result.purchaseId }, include: { tradingAccount: true } });
    expect(purchase).toMatchObject({ status: "PAID", amount: 0, listPrice: 1500, discountAmount: 1500, couponId: coupon.id });
    expect(purchase.providerTxRef).toMatch(/^COUPON-/);
    expect(purchase.tradingAccount?.status).toBe("ACTIVE");
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).redeemedCount).toBe(1);
  });

  it("lets exactly one of several concurrent redemptions take the last free slot", async () => {
    const users = await Promise.all([1, 2, 3, 4].map(() => fixtures.createUser()));
    const template = await fixtures.createTemplate({ price: 800 });
    const coupon = await makeCoupon({ percentOff: 100, maxRedemptions: 1 });

    const results = await Promise.allSettled(users.map((u) => initiateChapaPurchase(trader(u), template.id, undefined, { couponCode: coupon.code })));

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(3);
    for (const r of lost) {
      expect(r.reason).toBeInstanceOf(CouponError);
      expect(r.reason.reason).toBe("EXHAUSTED");
    }
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).redeemedCount).toBe(1);
    expect(await prisma.purchase.count({ where: { couponId: coupon.id, status: "PAID" } })).toBe(1);
    expect(await prisma.tradingAccount.count({ where: { userId: { in: users.map((u) => u.id) } } })).toBe(1);
    // Losing attempts are closed out, not left dangling.
    expect(await prisma.purchase.count({ where: { couponId: coupon.id, status: "PENDING" } })).toBe(0);
  });

  it("enforces the per-user limit atomically for concurrent free redemptions by one user", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 800 });
    const coupon = await makeCoupon({ percentOff: 100, perUserLimit: 1 });

    const results = await Promise.allSettled([1, 2, 3].map(() => initiateChapaPurchase(trader(user), template.id, undefined, { couponCode: coupon.code })));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.purchase.count({ where: { couponId: coupon.id, status: "PAID" } })).toBe(1);
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).redeemedCount).toBe(1);
  });

  it("counts a redemption once even if activation is repeated", async () => {
    const user = await fixtures.createUser();
    const admin = await fixtures.createUser("ADMIN");
    const template = await fixtures.createTemplate({ price: 800 });
    const coupon = await makeCoupon({ percentOff: 100 });
    const { purchaseId } = await initiateChapaPurchase(trader(user), template.id, undefined, { couponCode: coupon.code });

    await activatePurchase(purchaseId, { source: "ADMIN_TEST", adminId: admin.id });
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).redeemedCount).toBe(1);
  });
});

describe("admin coupon management", () => {
  const input = (overrides: Partial<CouponInput> = {}): CouponInput => ({
    code: uniqueCode("adm"),
    description: "test",
    percentOff: 10,
    amountOff: null,
    maxRedemptions: null,
    perUserLimit: 1,
    templateIds: [],
    validFrom: null,
    validUntil: null,
    active: true,
    ...overrides,
  });

  it("creates an upper-cased coupon, audited, and rejects inconsistent discounts and duplicate codes", async () => {
    const admin = await fixtures.createUser("ADMIN");
    const created = await createCoupon(input({ code: "  " + uniqueCode("low").toLowerCase() }), admin.id);
    couponIds.push(created.id);
    expect(created.code).toBe(created.code.toUpperCase());
    expect(await prisma.auditLog.count({ where: { action: "COUPON_CREATED", targetId: created.id, actorId: admin.id } })).toBe(1);

    await expect(createCoupon(input({ percentOff: 10, amountOff: 100 }), admin.id)).rejects.toThrow(/either a percentage or a fixed/);
    await expect(createCoupon(input({ percentOff: null, amountOff: null }), admin.id)).rejects.toThrow(/either a percentage or a fixed/);
    await expect(createCoupon(input({ validFrom: new Date(), validUntil: new Date(Date.now() - 1000) }), admin.id)).rejects.toThrow(/end date/);
    await expect(createCoupon(input({ code: created.code }), admin.id)).rejects.toThrow(/already exists/);
    await expect(createCoupon(input({ templateIds: ["not-a-template"] }), admin.id)).rejects.toThrow(/Phase 1/);
  });

  it("makes the code immutable once a purchase used the coupon, but allows other edits and deactivation", async () => {
    const admin = await fixtures.createUser("ADMIN");
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 1000 });
    const coupon = await makeCoupon({ percentOff: 10 });

    const renamed = uniqueCode("ren");
    const updated = await updateCoupon(coupon.id, { code: renamed }, admin.id);
    expect(updated.code).toBe(renamed);

    await initiateChapaPurchase(trader(user), template.id, undefined, { couponCode: renamed });
    await expect(updateCoupon(coupon.id, { code: uniqueCode("ren") }, admin.id)).rejects.toThrow(/cannot be changed/);

    const switched = await updateCoupon(coupon.id, { percentOff: null, amountOff: 50, active: false }, admin.id);
    expect(switched).toMatchObject({ percentOff: null, amountOff: 50, active: false, code: renamed });
    expect(await prisma.auditLog.count({ where: { action: "COUPON_DEACTIVATED", targetId: coupon.id } })).toBe(1);
  });
});
