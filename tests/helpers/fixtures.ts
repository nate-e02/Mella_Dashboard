import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { toTemplateSnapshot } from "@/types";
import type { AccountStatus, Role, Template } from "@prisma/client";

let counter = 0;
function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Creates and tracks throwaway database rows for one test, and tears them
 * all down afterwards. Integration tests in this suite run against the same
 * local Postgres database used for development (there is no separate test
 * database in this project), so every row a test creates must have a
 * unique, recognizable identity and must be cleaned up - this helper
 * centralizes both concerns instead of repeating them in every test file.
 */
export class TestFixtures {
  private userIds: string[] = [];
  private templateIds: string[] = [];
  private accountIds: string[] = [];

  async createUser(role: Role = "TRADER") {
    const suffix = uniqueSuffix();
    const user = await prisma.user.create({
      data: {
        name: `Vitest User ${suffix}`,
        email: `vitest-${suffix}@example.test`,
        passwordHash: await hashPassword("TestPassword123!"),
        role,
      },
    });
    this.userIds.push(user.id);
    return user;
  }

  async createTemplate(overrides: Partial<Parameters<typeof prisma.template.create>[0]["data"]> = {}) {
    const suffix = uniqueSuffix();
    const template = await prisma.template.create({
      data: {
        name: `Vitest Template ${suffix}`,
        groupName: "Vitest Group",
        groupKey: `vitest-group-${suffix}`,
        status: "ACTIVE",
        phase: "PHASE_1",
        programType: "STANDARD",
        startingBalance: 10000,
        accountSize: 10000,
        leverage: 100,
        profitTarget: 8,
        profitSplit: 80,
        maxDrawdown: 10,
        dailyDrawdown: 5,
        minTradingDays: 0,
        durationDays: 30,
        price: 49,
        ...overrides,
      },
    });
    this.templateIds.push(template.id);
    return template;
  }

  async createAccount(params: {
    userId: string;
    template: Template;
    status?: AccountStatus;
    startingBalance?: number;
    balance?: number;
    equity?: number;
    highWaterMark?: number;
    dailyAnchorBalance?: number;
    previousAccountId?: string;
  }) {
    const startingBalance = params.startingBalance ?? params.template.startingBalance;
    const snapshot = toTemplateSnapshot(params.template);

    const account = await prisma.tradingAccount.create({
      data: {
        userId: params.userId,
        templateId: params.template.id,
        previousAccountId: params.previousAccountId,
        snapshot: snapshot as never,
        phase: params.template.phase,
        status: params.status ?? "ACTIVE",
        startingBalance,
        balance: params.balance ?? startingBalance,
        equity: params.equity ?? startingBalance,
        highWaterMark: params.highWaterMark ?? startingBalance,
        dailyAnchorBalance: params.dailyAnchorBalance ?? startingBalance,
      },
    });
    this.accountIds.push(account.id);
    return account;
  }

  async addClosedTrade(accountId: string, netProfit: number, openTime: Date = new Date()) {
    return prisma.trade.create({
      data: {
        accountId,
        symbol: "EURUSD",
        side: "BUY",
        volume: 1,
        entryPrice: 1.1,
        exitPrice: 1.1,
        openTime,
        closeTime: new Date(openTime.getTime() + 60 * 60 * 1000),
        profit: netProfit,
        netProfit,
        status: "CLOSED",
      },
    });
  }

  /** All TradingAccounts created via createAccount, refreshed from the database. */
  async findAccountsByPreviousId(previousAccountId: string) {
    return prisma.tradingAccount.findMany({ where: { previousAccountId } });
  }

  async cleanup() {
    if (this.userIds.length > 0) {
      // Key off userId (not just the accountIds this helper itself created)
      // so accounts created indirectly by a service call under test - e.g.
      // createDemoPurchase(), or a next-phase account the challenge engine
      // creates on a PASSED transition - are swept up too.
      const ownedAccounts = await prisma.tradingAccount.findMany({
        where: { userId: { in: this.userIds } },
        select: { id: true },
      });
      const allAccountIds = [...new Set([...this.accountIds, ...ownedAccounts.map((a) => a.id)])];

      if (allAccountIds.length > 0) {
        await prisma.trade.deleteMany({ where: { accountId: { in: allAccountIds } } });
        await prisma.payout.deleteMany({ where: { tradingAccountId: { in: allAccountIds } } });
        await prisma.tradingAccount.deleteMany({ where: { id: { in: allAccountIds } } });
      }

      await prisma.purchase.deleteMany({ where: { userId: { in: this.userIds } } });
      await prisma.kycSubmission.deleteMany({ where: { OR: [{ userId: { in: this.userIds } }, { reviewerId: { in: this.userIds } }] } });
      await prisma.crmLead.deleteMany({ where: { userId: { in: this.userIds } } });
      await prisma.supportTicket.deleteMany({ where: { userId: { in: this.userIds } } });
      await prisma.notification.deleteMany({ where: { userId: { in: this.userIds } } });
      await prisma.auditLog.deleteMany({ where: { actorId: { in: this.userIds } } });
    }

    if (this.templateIds.length > 0) {
      // Null out self-referential nextPhaseId links between our own
      // templates first so the delete below can never hit a foreign-key
      // constraint regardless of Postgres's trigger timing.
      await prisma.template.updateMany({ where: { id: { in: this.templateIds } }, data: { nextPhaseId: null } });
      await prisma.template.deleteMany({ where: { id: { in: this.templateIds } } });
    }

    if (this.userIds.length > 0) {
      await prisma.session.deleteMany({ where: { userId: { in: this.userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: this.userIds } } });
    }

    this.accountIds = [];
    this.templateIds = [];
    this.userIds = [];
  }
}
