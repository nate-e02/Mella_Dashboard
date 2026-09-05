import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ACCOUNT_SIZES = [10000, 25000, 50000, 100000];

async function hash(pw: string) {
  return bcrypt.hash(pw, 10);
}

async function main() {
  console.log("Seeding database...");

  // ---------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "Admin12345!";
  const admin = await prisma.user.upsert({
    where: { email: "admin@mellafx.local" },
    update: {},
    create: {
      name: "Platform Admin",
      email: "admin@mellafx.local",
      passwordHash: await hash(adminPassword),
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  const traderSeeds = [
    { name: "Alex Morgan", email: "alex@mellafx.local" },
    { name: "Jamie Chen", email: "jamie@mellafx.local" },
    { name: "Sam Rivera", email: "sam@mellafx.local" },
    { name: "Taylor Brooks", email: "taylor@mellafx.local" },
  ];
  const traderPassword = process.env.SEED_TRADER_PASSWORD || "Trader1234!";

  const traders = [];
  for (const t of traderSeeds) {
    const user = await prisma.user.upsert({
      where: { email: t.email },
      update: {},
      create: {
        name: t.name,
        email: t.email,
        passwordHash: await hash(traderPassword),
        role: "TRADER",
        status: "ACTIVE",
        lastActivityAt: new Date(),
      },
    });
    traders.push(user);
  }

  // ---------------------------------------------------------------------
  // Templates: Standard 2-phase program at 4 account sizes, plus one
  // Aggressive single-phase-to-funded program.
  // ---------------------------------------------------------------------
  await prisma.template.deleteMany({});

  for (const size of ACCOUNT_SIZES) {
    const groupKey = `standard-${size}`;
    const groupName = "Standard";

    const funded = await prisma.template.create({
      data: {
        name: `Standard ${size / 1000}K Funded`,
        description: `Live funded account for ${size / 1000}K. 80/20 profit split, no further evaluation.`,
        price: 0,
        currency: "USD",
        status: "ACTIVE",
        phase: "FUNDED",
        programType: "STANDARD",
        groupName,
        groupKey,
        startingBalance: size,
        accountSize: size,
        leverage: 100,
        profitTarget: null,
        profitSplit: 80,
        maxDrawdown: 10,
        dailyDrawdown: 5,
        minTradingDays: 0,
        durationDays: null,
        passingRequirements: "N/A - this is a funded account.",
        failingRequirements: "Breach of max or daily drawdown.",
      },
    });

    const phase2 = await prisma.template.create({
      data: {
        name: `Standard ${size / 1000}K Phase 2`,
        description: `Phase 2 verification for ${size / 1000}K. 5% profit target, 60-day window.`,
        price: 0,
        currency: "USD",
        status: "ACTIVE",
        phase: "PHASE_2",
        programType: "STANDARD",
        groupName,
        groupKey,
        startingBalance: size,
        accountSize: size,
        leverage: 100,
        profitTarget: 5,
        profitSplit: 80,
        maxDrawdown: 10,
        dailyDrawdown: 5,
        minTradingDays: 5,
        durationDays: 60,
        passingRequirements: "Reach 5% profit target within 60 days while respecting drawdown limits.",
        failingRequirements: "Breach max drawdown (10%) or daily drawdown (5%).",
        nextPhaseId: funded.id,
      },
    });

    await prisma.template.create({
      data: {
        name: `Standard ${size / 1000}K Phase 1`,
        description: `Phase 1 evaluation for ${size / 1000}K. 8% profit target, 30-day window.`,
        price: size === 10000 ? 49 : size === 25000 ? 99 : size === 50000 ? 179 : 299,
        currency: "USD",
        status: "ACTIVE",
        phase: "PHASE_1",
        programType: "STANDARD",
        groupName,
        groupKey,
        startingBalance: size,
        accountSize: size,
        leverage: 100,
        profitTarget: 8,
        profitSplit: 80,
        maxDrawdown: 10,
        dailyDrawdown: 5,
        minTradingDays: 5,
        durationDays: 30,
        passingRequirements: "Reach 8% profit target within 30 days while respecting drawdown limits.",
        failingRequirements: "Breach max drawdown (10%) or daily drawdown (5%).",
        nextPhaseId: phase2.id,
      },
    });
  }

  // Aggressive single-phase program (10K + 25K)
  for (const size of [10000, 25000]) {
    const groupKey = `aggressive-${size}`;
    const groupName = "Aggressive";

    const funded = await prisma.template.create({
      data: {
        name: `Aggressive ${size / 1000}K Funded`,
        description: `Live funded account for the Aggressive ${size / 1000}K program. 90/10 profit split.`,
        price: 0,
        currency: "USD",
        status: "ACTIVE",
        phase: "FUNDED",
        programType: "AGGRESSIVE",
        groupName,
        groupKey,
        startingBalance: size,
        accountSize: size,
        leverage: 200,
        profitTarget: null,
        profitSplit: 90,
        maxDrawdown: 12,
        dailyDrawdown: 6,
        minTradingDays: 0,
        durationDays: null,
        passingRequirements: "N/A - this is a funded account.",
        failingRequirements: "Breach of max or daily drawdown.",
      },
    });

    await prisma.template.create({
      data: {
        name: `Aggressive ${size / 1000}K Challenge`,
        description: `Single-phase aggressive evaluation for ${size / 1000}K. 10% profit target, higher leverage.`,
        price: size === 10000 ? 69 : 139,
        currency: "USD",
        status: "ACTIVE",
        phase: "PHASE_1",
        programType: "AGGRESSIVE",
        groupName,
        groupKey,
        startingBalance: size,
        accountSize: size,
        leverage: 200,
        profitTarget: 10,
        profitSplit: 90,
        maxDrawdown: 12,
        dailyDrawdown: 6,
        minTradingDays: 3,
        durationDays: 30,
        passingRequirements: "Reach 10% profit target within 30 days while respecting drawdown limits.",
        failingRequirements: "Breach max drawdown (12%) or daily drawdown (6%).",
        nextPhaseId: funded.id,
      },
    });
  }

  // A draft template to demonstrate the Draft status
  await prisma.template.create({
    data: {
      name: "Crypto 10K Challenge (Draft)",
      description: "Upcoming crypto challenge program - not yet published.",
      price: 79,
      status: "DRAFT",
      phase: "PHASE_1",
      programType: "CRYPTO",
      groupName: "Crypto",
      groupKey: "crypto-10000",
      startingBalance: 10000,
      accountSize: 10000,
      leverage: 50,
      profitTarget: 8,
      maxDrawdown: 10,
      dailyDrawdown: 5,
      minTradingDays: 5,
      durationDays: 30,
    },
  });

  console.log(`Created ${ACCOUNT_SIZES.length * 3 + 2 * 2 + 1} templates.`);

  // ---------------------------------------------------------------------
  // Demo purchases + accounts + trades for the seeded traders
  // ---------------------------------------------------------------------
  const phase1Templates = await prisma.template.findMany({ where: { phase: "PHASE_1", status: "ACTIVE" } });

  function randomTransactionId() {
    return `DEMO-SEED-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  }

  async function purchaseAndCreateAccount(userId: string, template: (typeof phase1Templates)[number], daysAgo: number) {
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    const snapshot = {
      id: template.id,
      name: template.name,
      description: template.description,
      price: template.price,
      currency: template.currency,
      phase: template.phase,
      programType: template.programType,
      groupName: template.groupName,
      groupKey: template.groupKey,
      startingBalance: template.startingBalance,
      accountSize: template.accountSize,
      leverage: template.leverage,
      accountCurrency: template.accountCurrency,
      profitTarget: template.profitTarget,
      profitSplit: template.profitSplit,
      maxDrawdown: template.maxDrawdown,
      dailyDrawdown: template.dailyDrawdown,
      minTradingDays: template.minTradingDays,
      maxTradingDays: template.maxTradingDays,
      maxPositionSize: template.maxPositionSize,
      maxPositions: template.maxPositions,
      durationDays: template.durationDays,
      passingRequirements: template.passingRequirements,
      failingRequirements: template.failingRequirements,
      weekendHoldingAllowed: template.weekendHoldingAllowed,
      overnightHoldingAllowed: template.overnightHoldingAllowed,
      newsTradingAllowed: template.newsTradingAllowed,
      stopLossRequired: template.stopLossRequired,
      dailyLossResetTime: template.dailyLossResetTime,
      consistencyRequirement: template.consistencyRequirement,
      nextPhaseId: template.nextPhaseId,
      snapshotAt: createdAt.toISOString(),
    };

    const purchase = await prisma.purchase.create({
      data: {
        userId,
        templateId: template.id,
        status: "PAID",
        amount: template.price,
        currency: template.currency,
        demoTransactionId: randomTransactionId(),
        paymentDate: createdAt,
        createdAt,
        snapshot,
      },
    });

    const account = await prisma.tradingAccount.create({
      data: {
        userId,
        purchaseId: purchase.id,
        templateId: template.id,
        snapshot,
        phase: template.phase,
        status: "ACTIVE",
        startingBalance: template.startingBalance,
        balance: template.startingBalance,
        equity: template.startingBalance,
        highWaterMark: template.startingBalance,
        dailyAnchorBalance: template.startingBalance,
        createdAt,
        updatedAt: createdAt,
      },
    });

    return account;
  }

  const symbols = ["EURUSD", "GBPUSD", "XAUUSD", "US30", "NAS100", "BTCUSD"];

  async function seedTrades(accountId: string, startingBalance: number, count: number, winBias: number) {
    let running = 0;
    let openTime = new Date(Date.now() - count * 20 * 60 * 60 * 1000);
    for (let i = 0; i < count; i++) {
      const isWin = Math.random() < winBias;
      const volume = Number((0.1 + Math.random() * 2).toFixed(2));
      const pct = (isWin ? 1 : -1) * (0.2 + Math.random() * 1.2);
      const netProfit = Number(((startingBalance * pct) / 100).toFixed(2));
      running += netProfit;
      const closeTime = new Date(openTime.getTime() + (30 + Math.random() * 240) * 60 * 1000);
      await prisma.trade.create({
        data: {
          accountId,
          symbol: symbols[Math.floor(Math.random() * symbols.length)],
          side: Math.random() > 0.5 ? "BUY" : "SELL",
          volume,
          entryPrice: Number((1 + Math.random() * 100).toFixed(4)),
          exitPrice: Number((1 + Math.random() * 100).toFixed(4)),
          openTime,
          closeTime,
          profit: netProfit,
          netProfit,
          status: "CLOSED",
        },
      });
      openTime = new Date(openTime.getTime() + (12 + Math.random() * 24) * 60 * 60 * 1000);
    }
    return running;
  }

  // Trader 1 (Alex): active phase 1 account, doing well
  const t1 = phase1Templates.find((t) => t.groupKey === "standard-10000")!;
  const acc1 = await purchaseAndCreateAccount(traders[0].id, t1, 12);
  const pnl1 = await seedTrades(acc1.id, acc1.startingBalance, 14, 0.62);
  await prisma.tradingAccount.update({
    where: { id: acc1.id },
    data: {
      balance: acc1.startingBalance + pnl1,
      equity: acc1.startingBalance + pnl1,
      highWaterMark: acc1.startingBalance + Math.max(0, pnl1),
    },
  });

  // Trader 2 (Jamie): failed phase 1 account (breached drawdown)
  const t2 = phase1Templates.find((t) => t.groupKey === "standard-25000")!;
  const acc2 = await purchaseAndCreateAccount(traders[1].id, t2, 20);
  const pnl2 = await seedTrades(acc2.id, acc2.startingBalance, 10, 0.3);
  const failedBalance = acc2.startingBalance + Math.min(pnl2, -acc2.startingBalance * 0.11);
  await prisma.tradingAccount.update({
    where: { id: acc2.id },
    data: {
      balance: failedBalance,
      equity: failedBalance,
      highWaterMark: acc2.startingBalance,
      status: "FAILED",
      failedAt: new Date(),
      statusChangedAt: new Date(),
    },
  });

  // Trader 3 (Sam): passed phase 1 -> advanced to phase 2 -> funded, now trading funded
  const t3 = phase1Templates.find((t) => t.groupKey === "standard-50000")!;
  const acc3Phase1 = await purchaseAndCreateAccount(traders[2].id, t3, 60);
  await seedTrades(acc3Phase1.id, acc3Phase1.startingBalance, 12, 0.7);
  await prisma.tradingAccount.update({
    where: { id: acc3Phase1.id },
    data: { status: "PASSED", passedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), balance: acc3Phase1.startingBalance * 1.08, equity: acc3Phase1.startingBalance * 1.08 },
  });

  const phase2Template = await prisma.template.findFirst({ where: { groupKey: "standard-50000", phase: "PHASE_2" } });
  const fundedTemplate = await prisma.template.findFirst({ where: { groupKey: "standard-50000", phase: "FUNDED" } });

  if (phase2Template && fundedTemplate) {
    const acc3Phase2 = await prisma.tradingAccount.create({
      data: {
        userId: traders[2].id,
        templateId: phase2Template.id,
        previousAccountId: acc3Phase1.id,
        snapshot: acc3Phase1.snapshot as never,
        phase: "PHASE_2",
        status: "PASSED",
        startingBalance: phase2Template.startingBalance,
        balance: phase2Template.startingBalance * 1.06,
        equity: phase2Template.startingBalance * 1.06,
        highWaterMark: phase2Template.startingBalance * 1.06,
        dailyAnchorBalance: phase2Template.startingBalance,
        passedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 38 * 24 * 60 * 60 * 1000),
      },
    });

    const acc3Funded = await prisma.tradingAccount.create({
      data: {
        userId: traders[2].id,
        templateId: fundedTemplate.id,
        previousAccountId: acc3Phase2.id,
        snapshot: acc3Phase1.snapshot as never,
        phase: "FUNDED",
        status: "FUNDED",
        startingBalance: fundedTemplate.startingBalance,
        balance: fundedTemplate.startingBalance,
        equity: fundedTemplate.startingBalance,
        highWaterMark: fundedTemplate.startingBalance,
        dailyAnchorBalance: fundedTemplate.startingBalance,
        fundedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      },
    });
    const pnlFunded = await seedTrades(acc3Funded.id, acc3Funded.startingBalance, 20, 0.65);
    await prisma.tradingAccount.update({
      where: { id: acc3Funded.id },
      data: {
        balance: acc3Funded.startingBalance + pnlFunded,
        equity: acc3Funded.startingBalance + pnlFunded,
        highWaterMark: acc3Funded.startingBalance + Math.max(0, pnlFunded),
      },
    });

    await prisma.payout.create({
      data: {
        tradingAccountId: acc3Funded.id,
        userId: traders[2].id,
        amount: 850,
        status: "PAID",
        requestedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        paidAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      },
    });
  }

  // Trader 4 (Taylor): fresh account, no trades yet (empty state demo)
  const t4 = phase1Templates.find((t) => t.groupKey === "aggressive-10000")!;
  await purchaseAndCreateAccount(traders[3].id, t4, 1);

  // ---------------------------------------------------------------------
  // KYC submissions
  // ---------------------------------------------------------------------
  await prisma.kycSubmission.create({
    data: {
      userId: traders[0].id,
      fullName: traders[0].name,
      country: "United States",
      documentType: "Passport",
      status: "APPROVED",
      submittedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      reviewedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
      reviewerId: admin.id,
      notes: "Documents verified, no issues.",
    },
  });
  await prisma.kycSubmission.create({
    data: {
      userId: traders[1].id,
      fullName: traders[1].name,
      country: "Canada",
      documentType: "Driver's License",
      status: "PENDING",
      submittedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.kycSubmission.create({
    data: {
      userId: traders[2].id,
      fullName: traders[2].name,
      country: "United Kingdom",
      documentType: "National ID",
      status: "REJECTED",
      submittedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      reviewedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      reviewerId: admin.id,
      notes: "Document photo unclear, please resubmit.",
    },
  });

  // ---------------------------------------------------------------------
  // CRM leads + support ticket
  // ---------------------------------------------------------------------
  await prisma.crmLead.createMany({
    data: [
      { name: "Morgan Lee", email: "morgan.lee@example.com", status: "NEW", source: "Google Ads", value: 199 },
      { name: "Chris Patel", email: "chris.patel@example.com", status: "QUALIFIED", source: "Referral", value: 99 },
      { name: "Jordan Kim", email: "jordan.kim@example.com", status: "NEGOTIATION", source: "Website", value: 299 },
      { name: "Riley Scott", email: "riley.scott@example.com", status: "LOST", source: "Twitter", value: 49 },
    ],
  });
  await prisma.crmLead.create({
    data: { name: traders[0].name, email: traders[0].email, status: "CONVERTED", source: "Website", value: t1.price, userId: traders[0].id },
  });

  await prisma.supportTicket.create({
    data: {
      userId: traders[1].id,
      subject: "Question about daily drawdown reset time",
      message: "What timezone is the daily loss reset calculated in?",
      status: "OPEN",
    },
  });

  console.log("Seed complete.");
  console.log("----------------------------------------");
  console.log(`Admin login:  admin@mellafx.local / ${adminPassword}`);
  console.log(`Trader login: alex@mellafx.local / ${traderPassword} (and jamie/sam/taylor@mellafx.local)`);
  console.log("----------------------------------------");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
