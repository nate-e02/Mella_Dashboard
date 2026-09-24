import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { evaluateAccount } from "@/lib/services/challengeEngine";
import { decidePayout } from "@/lib/services/payouts";
import { getPublicCertificate, issueCertificate, listCertificatesForUser } from "@/lib/services/certificates";
import { TestFixtures } from "./helpers/fixtures";

const fixtures = new TestFixtures();
afterEach(() => fixtures.cleanup());

async function namedUser(name: string) {
  const user = await fixtures.createUser();
  await prisma.user.update({ where: { id: user.id }, data: { name } });
  return user;
}

describe("certificates issued by the challenge engine", () => {
  it("issues one CHALLENGE_PASSED certificate when a phase is passed, even if evaluated again", async () => {
    const user = await namedUser("Abebe Kebede");
    const phase2 = await fixtures.createTemplate({ phase: "PHASE_2", profitTarget: 5 });
    const phase1 = await fixtures.createTemplate({
      phase: "PHASE_1",
      profitTarget: 8,
      nextPhaseId: phase2.id,
      groupName: "Standard 2-Step",
      accountSize: 1_000_000,
      startingBalance: 1_000_000,
    });
    const account = await fixtures.createAccount({ userId: user.id, template: phase1 });
    await fixtures.addClosedTrade(account.id, 90_000);

    await evaluateAccount(account.id);
    await evaluateAccount(account.id);

    const certs = await prisma.certificate.findMany({ where: { userId: user.id } });
    expect(certs).toHaveLength(1);
    expect(certs[0]).toMatchObject({
      type: "CHALLENGE_PASSED",
      accountId: account.id,
      dedupeKey: `CHALLENGE_PASSED:${account.id}`,
      title: "Phase 1 Passed — 1,000,000 ETB Standard 2-Step",
      recipientName: "Abebe K.",
    });
    expect(certs[0].publicId).toMatch(/^[a-z2-7]{12}$/);
    expect(certs[0].metadata).toMatchObject({ phase: "PHASE_1", accountSize: 1_000_000, program: "Standard 2-Step" });
    expect(await prisma.notification.count({ where: { userId: user.id, link: "/certificates" } })).toBe(1);
  });

  it("issues CHALLENGE_PASSED for phase 2 and FUNDED for the new funded account", async () => {
    const user = await fixtures.createUser();
    const funded = await fixtures.createTemplate({ phase: "FUNDED", profitTarget: null });
    const phase2 = await fixtures.createTemplate({ phase: "PHASE_2", profitTarget: 5, nextPhaseId: funded.id });
    const account = await fixtures.createAccount({ userId: user.id, template: phase2 });
    await fixtures.addClosedTrade(account.id, 600);

    await evaluateAccount(account.id);

    const [fundedAccount] = await fixtures.findAccountsByPreviousId(account.id);
    expect(fundedAccount.status).toBe("FUNDED");
    const certs = await prisma.certificate.findMany({ where: { userId: user.id }, orderBy: { type: "asc" } });
    expect(certs.map((c) => [c.type, c.accountId])).toEqual([
      ["CHALLENGE_PASSED", account.id],
      ["FUNDED", fundedAccount.id],
    ]);
    expect(certs[1].title).toMatch(/^Funded Trader — 10,000 ETB/);
  });

  it("issues nothing when an account fails", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ maxDrawdown: 10, dailyDrawdown: 50 });
    const account = await fixtures.createAccount({ userId: user.id, template });
    await fixtures.addClosedTrade(account.id, -1500);
    await evaluateAccount(account.id);
    expect(await prisma.certificate.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("payout certificates", () => {
  it("issues a PAYOUT certificate with the amount when a payout is marked paid", async () => {
    const [creator, approver, payer] = [await fixtures.createUser("ADMIN"), await fixtures.createUser("ADMIN"), await fixtures.createUser("ADMIN")];
    const trader = await fixtures.createUser();
    const template = await fixtures.createTemplate({ phase: "FUNDED", profitTarget: null, profitSplit: 80 });
    const account = await fixtures.createAccount({ userId: trader.id, template, status: "FUNDED", balance: 40_000, equity: 40_000 });
    const payout = await prisma.payout.create({
      data: { tradingAccountId: account.id, userId: trader.id, amount: 25_000, status: "APPROVED", createdById: creator.id, approvedById: approver.id, approvedAt: new Date() },
    });

    await decidePayout(payout.id, "PAID", payer.id, { providerRef: "TB-1" });

    const cert = await prisma.certificate.findUniqueOrThrow({ where: { dedupeKey: `PAYOUT:${payout.id}` } });
    expect(cert).toMatchObject({ type: "PAYOUT", amount: 25_000, currency: "ETB", title: "Payout — 25,000 ETB", userId: trader.id, accountId: account.id });
  });
});

describe("issueCertificate", () => {
  it("is idempotent by dedupe key, including under concurrency", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate();
    const account = await fixtures.createAccount({ userId: user.id, template, status: "PASSED" });

    const results = await Promise.all([1, 2, 3].map(() => issueCertificate(prisma, { type: "CHALLENGE_PASSED", userId: user.id, accountId: account.id })));

    expect(new Set(results.map((c) => c.id)).size).toBe(1);
    expect(await prisma.certificate.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: user.id, link: "/certificates" } })).toBe(1);
  });

  it("exposes only printable fields publicly and 404s unknown ids", async () => {
    const user = await namedUser("Hanna Tesfaye");
    const template = await fixtures.createTemplate();
    const account = await fixtures.createAccount({ userId: user.id, template, status: "PASSED" });
    const cert = await issueCertificate(prisma, { type: "CHALLENGE_PASSED", userId: user.id, accountId: account.id });

    const pub = await getPublicCertificate(cert.publicId);
    expect(pub).not.toBeNull();
    expect(Object.keys(pub!).sort()).toEqual(["amount", "currency", "issuedAt", "metadata", "publicId", "recipientName", "title", "type"]);
    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain(user.id);
    expect(serialized).not.toContain(user.email);
    expect(serialized).not.toContain("Tesfaye");

    expect(await getPublicCertificate("aaaaaaaaaaaa")).toBeNull();
    expect(await getPublicCertificate("not a valid id")).toBeNull();
    expect((await listCertificatesForUser(user.id)).map((c) => c.publicId)).toEqual([cert.publicId]);
  });
});
