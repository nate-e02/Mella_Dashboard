import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { refundPurchase, cancelPurchase, createDemoPurchase } from "@/lib/services/purchases";
import { decideKyc, createKycSubmission } from "@/lib/services/kyc";
import { decidePayout, createPayout } from "@/lib/services/payouts";
import { ConflictError } from "@/lib/auth/guards";
import { TestFixtures } from "./helpers/fixtures";

const fixtures = new TestFixtures();
afterEach(() => fixtures.cleanup());

describe("invalid state transitions are rejected", () => {
  it("cannot refund a purchase twice", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();
    const { purchase } = await createDemoPurchase(user.id, template.id, 49);

    await refundPurchase(purchase.id, user.id);

    await expect(refundPurchase(purchase.id, user.id)).rejects.toThrow(ConflictError);
  });

  it("cannot cancel a purchase that has already been refunded", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();
    const { purchase } = await createDemoPurchase(user.id, template.id, 49);

    await refundPurchase(purchase.id, user.id);

    await expect(cancelPurchase(purchase.id, user.id)).rejects.toThrow(ConflictError);
  });

  it("cannot decide the same KYC submission twice", async () => {
    const trader = await fixtures.createUser("TRADER");
    const admin = await fixtures.createUser("ADMIN");
    const submission = await createKycSubmission({
      userId: trader.id,
      fullName: "Test Trader",
      country: "Testland",
      documentType: "Passport",
    });

    await decideKyc(submission.id, "APPROVED", undefined, admin.id);

    await expect(decideKyc(submission.id, "REJECTED", undefined, admin.id)).rejects.toThrow(ConflictError);

    const final = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(final.status).toBe("APPROVED"); // unchanged by the rejected second decision
  });

  it("cannot decide the same payout twice", async () => {
    const trader = await fixtures.createUser("TRADER");
    const admin = await fixtures.createUser("ADMIN");
    const template = await fixtures.createTemplate({ phase: "FUNDED", profitTarget: null });
    const account = await fixtures.createAccount({ userId: trader.id, template, status: "FUNDED" });
    const payout = await createPayout(account.id, 500, admin.id);

    await decidePayout(payout.id, "PAID", admin.id);

    await expect(decidePayout(payout.id, "REJECTED", admin.id)).rejects.toThrow(ConflictError);
  });
});
