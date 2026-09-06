import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  activatePurchase,
  initiateChapaPurchase,
  verifyAndCompleteChapaPurchase,
} from "@/lib/services/purchases";
import { initiatePurchaseSchema } from "@/lib/validation/schemas";
import { TestFixtures } from "./helpers/fixtures";
import type { ChapaVerification } from "@/lib/services/chapa";

// The Chapa API is mocked at the service-module boundary for every test in
// this file - no real network calls are made. `CHAPA_CURRENCY` and the
// webhook-signature helper are left as the real implementation since they
// don't touch the network.
vi.mock("@/lib/services/chapa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/chapa")>();
  return {
    ...actual,
    initializeChapaTransaction: vi.fn(),
    verifyChapaTransaction: vi.fn(),
  };
});

import { initializeChapaTransaction, verifyChapaTransaction } from "@/lib/services/chapa";

const mockInitialize = vi.mocked(initializeChapaTransaction);
const mockVerify = vi.mocked(verifyChapaTransaction);

const fixtures = new TestFixtures();

beforeEach(() => {
  mockInitialize.mockReset();
  mockVerify.mockReset();
  mockInitialize.mockResolvedValue({ checkoutUrl: "https://checkout.chapa.co/checkout/payment/mock" });
});

afterEach(() => fixtures.cleanup());

function traderUser(user: { id: string; name: string; email: string }) {
  return { id: user.id, name: user.name, email: user.email };
}

describe("price integrity", () => {
  it("silently drops a client-supplied amount - it never reaches the service layer", () => {
    const parsed = initiatePurchaseSchema.parse({ templateId: "abc", amount: 1 });
    expect(parsed).not.toHaveProperty("amount");
  });

  it("initializes Chapa with exactly the template's database price, never a caller-supplied one", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 733.5 });

    await initiateChapaPurchase(traderUser(user), template.id);

    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockInitialize.mock.calls[0][0].amount).toBe(733.5);

    const purchase = await prisma.purchase.findFirstOrThrow({ where: { userId: user.id } });
    expect(purchase.amount).toBe(733.5);
    expect(purchase.status).toBe("PENDING");
  });
});

describe("initiateChapaPurchase", () => {
  it("creates a PENDING purchase without a trading account, using the template snapshot", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 99, startingBalance: 25000, accountSize: 25000 });

    const result = await initiateChapaPurchase(traderUser(user), template.id);

    expect(result.outcome).toBe("REDIRECT");
    const purchase = await prisma.purchase.findFirstOrThrow({ where: { userId: user.id } });
    expect(purchase.status).toBe("PENDING");
    expect(purchase.currency).toBe("ETB");
    expect((purchase.snapshot as { startingBalance: number }).startingBalance).toBe(25000);

    const account = await prisma.tradingAccount.findFirst({ where: { userId: user.id } });
    expect(account).toBeNull(); // no account until payment is verified
  });

  it("rejects a purchase of a template that is not ACTIVE", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ status: "DRAFT" });

    await expect(initiateChapaPurchase(traderUser(user), template.id)).rejects.toThrow(/no longer available/);
    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it("rejects a direct purchase of a non-Phase-1 template", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ phase: "PHASE_2" });

    await expect(initiateChapaPurchase(traderUser(user), template.id)).rejects.toThrow(/Phase 1/);
  });

  it("marks the purchase FAILED (not left dangling PENDING) if Chapa initialize itself fails", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();
    mockInitialize.mockRejectedValueOnce(new Error("network timeout"));

    await expect(initiateChapaPurchase(traderUser(user), template.id)).rejects.toThrow(/Unable to start payment/);

    const purchase = await prisma.purchase.findFirstOrThrow({ where: { userId: user.id } });
    expect(purchase.status).toBe("FAILED");
  });

  it("is idempotent: retrying the same purchase attempt with the same key reuses the same Purchase row", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();
    const key = `test-key-${Date.now()}`;

    const first = await initiateChapaPurchase(traderUser(user), template.id, key);
    const second = await initiateChapaPurchase(traderUser(user), template.id, key);

    expect(first.outcome).toBe("REDIRECT");
    expect(second.outcome).toBe("REDIRECT");
    if (first.outcome === "REDIRECT" && second.outcome === "REDIRECT") {
      expect(second.purchaseId).toBe(first.purchaseId);
    }

    const purchaseCount = await prisma.purchase.count({ where: { userId: user.id, templateId: template.id } });
    expect(purchaseCount).toBe(1);
    // Chapa is re-initialized on retry (fresh checkout session) but for the same tx_ref/purchase.
    expect(mockInitialize).toHaveBeenCalledTimes(2);
  });

  it("does not create duplicate purchases when the same idempotency key is submitted concurrently (double-click)", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();
    const key = `test-key-concurrent-${Date.now()}`;

    const results = await Promise.allSettled([
      initiateChapaPurchase(traderUser(user), template.id, key),
      initiateChapaPurchase(traderUser(user), template.id, key),
      initiateChapaPurchase(traderUser(user), template.id, key),
    ]);

    for (const result of results) {
      expect(result.status).toBe("fulfilled");
    }

    const purchaseCount = await prisma.purchase.count({ where: { userId: user.id, templateId: template.id } });
    expect(purchaseCount).toBe(1);
  });

  it("reports ALREADY_PAID (no new Chapa session) when retried with a key belonging to a completed purchase", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();
    const key = `test-key-paid-${Date.now()}`;

    const initiated = await initiateChapaPurchase(traderUser(user), template.id, key);
    if (initiated.outcome !== "REDIRECT") throw new Error("expected REDIRECT");
    mockVerify.mockResolvedValueOnce(successfulVerification(await prisma.purchase.findUniqueOrThrow({ where: { id: initiated.purchaseId } })));
    await verifyAndCompleteChapaPurchase((await prisma.purchase.findUniqueOrThrow({ where: { id: initiated.purchaseId } })).providerTxRef);

    mockInitialize.mockClear();
    const retried = await initiateChapaPurchase(traderUser(user), template.id, key);

    expect(retried).toEqual({ outcome: "ALREADY_PAID", purchaseId: initiated.purchaseId });
    expect(mockInitialize).not.toHaveBeenCalled();
  });

  it("allows the same user to legitimately purchase the same template multiple times without a key (repeat attempts)", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();

    await initiateChapaPurchase(traderUser(user), template.id);
    await initiateChapaPurchase(traderUser(user), template.id);

    const purchaseCount = await prisma.purchase.count({ where: { userId: user.id, templateId: template.id } });
    expect(purchaseCount).toBe(2);
  });
});

function successfulVerification(purchase: { amount: number; currency: string; providerTxRef: string }): ChapaVerification {
  return { paymentStatus: "success", amount: purchase.amount, currency: purchase.currency, txRef: purchase.providerTxRef };
}

describe("verifyAndCompleteChapaPurchase", () => {
  it("activates the purchase and creates the trading account on successful verification", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 150 });
    const initiated = await initiateChapaPurchase(traderUser(user), template.id);
    if (initiated.outcome !== "REDIRECT") throw new Error("expected REDIRECT");
    const purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: initiated.purchaseId } });
    mockVerify.mockResolvedValueOnce(successfulVerification(purchase));

    const result = await verifyAndCompleteChapaPurchase(purchase.providerTxRef);

    expect(result).toEqual({ outcome: "PAID", purchaseId: purchase.id });
    const updated = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
    expect(updated.status).toBe("PAID");
    const account = await prisma.tradingAccount.findUnique({ where: { purchaseId: purchase.id } });
    expect(account).not.toBeNull();
    expect(account?.status).toBe("ACTIVE");
    expect(account?.startingBalance).toBe(template.startingBalance);
  });

  it("does not activate the purchase when Chapa reports the payment failed", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();
    const initiated = await initiateChapaPurchase(traderUser(user), template.id);
    if (initiated.outcome !== "REDIRECT") throw new Error("expected REDIRECT");
    const purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: initiated.purchaseId } });
    mockVerify.mockResolvedValueOnce({ paymentStatus: "failed", amount: purchase.amount, currency: purchase.currency, txRef: purchase.providerTxRef });

    const result = await verifyAndCompleteChapaPurchase(purchase.providerTxRef);

    expect(result).toEqual({ outcome: "FAILED", purchaseId: purchase.id });
    const updated = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
    expect(updated.status).toBe("FAILED");
    expect(await prisma.tradingAccount.findUnique({ where: { purchaseId: purchase.id } })).toBeNull();
  });

  it("leaves the purchase PENDING (does not activate) when Chapa reports the payment pending", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();
    const initiated = await initiateChapaPurchase(traderUser(user), template.id);
    if (initiated.outcome !== "REDIRECT") throw new Error("expected REDIRECT");
    const purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: initiated.purchaseId } });
    mockVerify.mockResolvedValueOnce({ paymentStatus: "pending", amount: purchase.amount, currency: purchase.currency, txRef: purchase.providerTxRef });

    const result = await verifyAndCompleteChapaPurchase(purchase.providerTxRef);

    expect(result).toEqual({ outcome: "PENDING", purchaseId: purchase.id });
    const updated = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
    expect(updated.status).toBe("PENDING");
    expect(await prisma.tradingAccount.findUnique({ where: { purchaseId: purchase.id } })).toBeNull();
  });

  it("does not activate on an amount mismatch, even if Chapa reports success", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 200 });
    const initiated = await initiateChapaPurchase(traderUser(user), template.id);
    if (initiated.outcome !== "REDIRECT") throw new Error("expected REDIRECT");
    const purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: initiated.purchaseId } });
    // Chapa claims success, but for a different (tampered/incorrect) amount.
    mockVerify.mockResolvedValueOnce({ paymentStatus: "success", amount: 1, currency: purchase.currency, txRef: purchase.providerTxRef });

    const result = await verifyAndCompleteChapaPurchase(purchase.providerTxRef);

    expect(result.outcome).toBe("FAILED");
    const updated = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
    expect(updated.status).toBe("FAILED");
    expect(await prisma.tradingAccount.findUnique({ where: { purchaseId: purchase.id } })).toBeNull();
  });

  it("does not activate on a currency mismatch, even if Chapa reports success with the right amount", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 200 });
    const initiated = await initiateChapaPurchase(traderUser(user), template.id);
    if (initiated.outcome !== "REDIRECT") throw new Error("expected REDIRECT");
    const purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: initiated.purchaseId } });
    mockVerify.mockResolvedValueOnce({ paymentStatus: "success", amount: purchase.amount, currency: "USD", txRef: purchase.providerTxRef });

    const result = await verifyAndCompleteChapaPurchase(purchase.providerTxRef);

    expect(result.outcome).toBe("FAILED");
  });

  it("returns NOT_FOUND for an unknown tx_ref without throwing", async () => {
    const result = await verifyAndCompleteChapaPurchase("does-not-exist");
    expect(result).toEqual({ outcome: "NOT_FOUND" });
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("is idempotent: a repeated call (simulating callback + webhook, or a retried webhook) does not call Chapa again or duplicate the account", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();
    const initiated = await initiateChapaPurchase(traderUser(user), template.id);
    if (initiated.outcome !== "REDIRECT") throw new Error("expected REDIRECT");
    const purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: initiated.purchaseId } });
    mockVerify.mockResolvedValue(successfulVerification(purchase));

    const first = await verifyAndCompleteChapaPurchase(purchase.providerTxRef);
    const second = await verifyAndCompleteChapaPurchase(purchase.providerTxRef);

    expect(first.outcome).toBe("PAID");
    expect(second.outcome).toBe("ALREADY_PAID");
    expect(mockVerify).toHaveBeenCalledTimes(1); // second call short-circuited before ever calling Chapa again

    const accountCount = await prisma.tradingAccount.count({ where: { purchaseId: purchase.id } });
    expect(accountCount).toBe(1);
  });

  it("does not create duplicate accounts when callback and webhook race each other concurrently", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();
    const initiated = await initiateChapaPurchase(traderUser(user), template.id);
    if (initiated.outcome !== "REDIRECT") throw new Error("expected REDIRECT");
    const purchase = await prisma.purchase.findUniqueOrThrow({ where: { id: initiated.purchaseId } });
    mockVerify.mockResolvedValue(successfulVerification(purchase));

    const results = await Promise.allSettled([
      verifyAndCompleteChapaPurchase(purchase.providerTxRef),
      verifyAndCompleteChapaPurchase(purchase.providerTxRef),
      verifyAndCompleteChapaPurchase(purchase.providerTxRef),
      verifyAndCompleteChapaPurchase(purchase.providerTxRef),
    ]);

    for (const result of results) {
      expect(result.status).toBe("fulfilled");
    }

    const accountCount = await prisma.tradingAccount.count({ where: { purchaseId: purchase.id } });
    expect(accountCount).toBe(1);

    const updated = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
    expect(updated.status).toBe("PAID");

    const activationLogs = await prisma.auditLog.findMany({
      where: { targetType: "Purchase", targetId: purchase.id, action: "CHAPA_PAYMENT_VERIFIED" },
    });
    expect(activationLogs).toHaveLength(1);
  });
});

describe("activatePurchase (shared by Chapa verification and the admin test-paid action)", () => {
  it("produces the same resulting purchase/account state for the admin test-paid path as for a verified Chapa payment", async () => {
    const trader = await fixtures.createUser("TRADER");
    const admin = await fixtures.createUser("ADMIN");
    const template = await fixtures.createTemplate({ price: 88 });
    const initiated = await initiateChapaPurchase(traderUser(trader), template.id);
    if (initiated.outcome !== "REDIRECT") throw new Error("expected REDIRECT");

    const { purchase, account } = await activatePurchase(initiated.purchaseId, { source: "ADMIN_TEST", adminId: admin.id });

    expect(purchase.status).toBe("PAID");
    expect(account?.status).toBe("ACTIVE");
    expect(account?.startingBalance).toBe(template.startingBalance);

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { targetType: "Purchase", targetId: purchase.id, action: "PURCHASE_MARKED_PAID_BY_ADMIN_TEST" },
    });
    expect(log.actorId).toBe(admin.id);
  });

  it("is idempotent: repeated admin activation does not duplicate the account or the audit log", async () => {
    const trader = await fixtures.createUser("TRADER");
    const admin = await fixtures.createUser("ADMIN");
    const template = await fixtures.createTemplate();
    const initiated = await initiateChapaPurchase(traderUser(trader), template.id);
    if (initiated.outcome !== "REDIRECT") throw new Error("expected REDIRECT");

    await activatePurchase(initiated.purchaseId, { source: "ADMIN_TEST", adminId: admin.id });
    await activatePurchase(initiated.purchaseId, { source: "ADMIN_TEST", adminId: admin.id });

    const accountCount = await prisma.tradingAccount.count({ where: { purchaseId: initiated.purchaseId } });
    expect(accountCount).toBe(1);
    const logCount = await prisma.auditLog.count({
      where: { targetType: "Purchase", targetId: initiated.purchaseId, action: "PURCHASE_MARKED_PAID_BY_ADMIN_TEST" },
    });
    expect(logCount).toBe(1);
  });

  it("does not duplicate the account when concurrent admin activations race each other", async () => {
    const trader = await fixtures.createUser("TRADER");
    const admin = await fixtures.createUser("ADMIN");
    const template = await fixtures.createTemplate();
    const initiated = await initiateChapaPurchase(traderUser(trader), template.id);
    if (initiated.outcome !== "REDIRECT") throw new Error("expected REDIRECT");

    const results = await Promise.allSettled([
      activatePurchase(initiated.purchaseId, { source: "ADMIN_TEST", adminId: admin.id }),
      activatePurchase(initiated.purchaseId, { source: "ADMIN_TEST", adminId: admin.id }),
      activatePurchase(initiated.purchaseId, { source: "ADMIN_TEST", adminId: admin.id }),
    ]);

    for (const result of results) expect(result.status).toBe("fulfilled");

    const accountCount = await prisma.tradingAccount.count({ where: { purchaseId: initiated.purchaseId } });
    expect(accountCount).toBe(1);
  });
});
