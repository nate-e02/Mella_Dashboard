import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createDemoPurchase } from "@/lib/services/purchases";
import { TestFixtures } from "./helpers/fixtures";

const fixtures = new TestFixtures();
afterEach(() => fixtures.cleanup());

describe("createDemoPurchase", () => {
  it("creates a Purchase and a matching TradingAccount for the correct user, using the template snapshot", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 99, startingBalance: 25000, accountSize: 25000 });

    const { purchase, account } = await createDemoPurchase(user.id, template.id, 99);

    expect(purchase.userId).toBe(user.id);
    expect(purchase.status).toBe("PAID");
    expect(purchase.amount).toBe(99);
    expect(account?.userId).toBe(user.id);
    expect(account?.startingBalance).toBe(25000);
    expect(account?.status).toBe("ACTIVE");
    expect((account?.snapshot as { profitTarget: number }).profitTarget).toBe(template.profitTarget);
  });

  it("rejects a purchase of a template that is not ACTIVE", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ status: "DRAFT" });

    await expect(createDemoPurchase(user.id, template.id, 49)).rejects.toThrow(/no longer available/);
  });

  it("rejects a direct purchase of a non-Phase-1 template", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ phase: "PHASE_2" });

    await expect(createDemoPurchase(user.id, template.id, 49)).rejects.toThrow(/Phase 1/);
  });

  it("is idempotent: retrying the same purchase attempt with the same key does not create a second purchase/account", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();
    const key = `test-key-${Date.now()}`;

    const first = await createDemoPurchase(user.id, template.id, 49, key);
    const second = await createDemoPurchase(user.id, template.id, 49, key);

    expect(second.purchase.id).toBe(first.purchase.id);
    expect(second.account?.id).toBe(first.account?.id);

    const purchaseCount = await prisma.purchase.count({ where: { userId: user.id, templateId: template.id } });
    expect(purchaseCount).toBe(1);
    const accountCount = await prisma.tradingAccount.count({ where: { userId: user.id, templateId: template.id } });
    expect(accountCount).toBe(1);
  });

  it("does not create duplicate purchases when the same idempotency key is submitted concurrently (double-click)", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();
    const key = `test-key-concurrent-${Date.now()}`;

    const results = await Promise.allSettled([
      createDemoPurchase(user.id, template.id, 49, key),
      createDemoPurchase(user.id, template.id, 49, key),
      createDemoPurchase(user.id, template.id, 49, key),
    ]);

    for (const result of results) {
      expect(result.status).toBe("fulfilled");
    }

    const purchaseCount = await prisma.purchase.count({ where: { userId: user.id, templateId: template.id } });
    expect(purchaseCount).toBe(1);
    const accountCount = await prisma.tradingAccount.count({ where: { userId: user.id, templateId: template.id } });
    expect(accountCount).toBe(1);
  });

  it("allows the same user to legitimately purchase the same template multiple times without a key (repeat attempts)", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();

    await createDemoPurchase(user.id, template.id, 49);
    await createDemoPurchase(user.id, template.id, 49);

    const purchaseCount = await prisma.purchase.count({ where: { userId: user.id, templateId: template.id } });
    expect(purchaseCount).toBe(2);
  });
});
