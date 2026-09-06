import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { listAccountsForUser, getAccountById } from "@/lib/services/accounts";
import { assertOwnsResource } from "@/lib/auth/ownership";
import { AuthError } from "@/lib/auth/guards";
import { TestFixtures } from "./helpers/fixtures";

const fixtures = new TestFixtures();
afterEach(() => fixtures.cleanup());

describe("trader resource scoping", () => {
  it("only returns a trader's own accounts, never another trader's", async () => {
    const traderA = await fixtures.createUser("TRADER");
    const traderB = await fixtures.createUser("TRADER");
    const template = await fixtures.createTemplate();

    const accountA = await fixtures.createAccount({ userId: traderA.id, template });
    await fixtures.createAccount({ userId: traderB.id, template });

    const accountsForA = await listAccountsForUser(traderA.id);

    expect(accountsForA.map((a) => a.id)).toEqual([accountA.id]);
  });

  it("rejects (via assertOwnsResource) a trader fetching another trader's account by id - the IDOR path", async () => {
    const traderA = await fixtures.createUser("TRADER");
    const traderB = await fixtures.createUser("TRADER");
    const template = await fixtures.createTemplate();
    const accountB = await fixtures.createAccount({ userId: traderB.id, template });

    // Mirrors exactly what /api/trader/accounts/[id]/trades does: look the
    // account up, then assert ownership against the requesting user.
    const account = await prisma.tradingAccount.findUnique({ where: { id: accountB.id }, select: { userId: true } });

    expect(() => assertOwnsResource(account?.userId, traderA.id)).toThrow(AuthError);
  });

  it("allows a trader to fetch their own account by id via the same check", async () => {
    const traderA = await fixtures.createUser("TRADER");
    const template = await fixtures.createTemplate();
    const accountA = await fixtures.createAccount({ userId: traderA.id, template });

    const account = await prisma.tradingAccount.findUnique({ where: { id: accountA.id }, select: { userId: true } });

    expect(() => assertOwnsResource(account?.userId, traderA.id)).not.toThrow();
  });

  it("admin-facing getAccountById is not scoped to any single user (by design - admins see every account)", async () => {
    const traderA = await fixtures.createUser("TRADER");
    const template = await fixtures.createTemplate();
    const accountA = await fixtures.createAccount({ userId: traderA.id, template });

    const account = await getAccountById(accountA.id);

    expect(account?.userId).toBe(traderA.id);
  });
});
