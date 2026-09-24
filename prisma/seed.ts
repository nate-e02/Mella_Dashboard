import { PrismaClient, type Template } from "@prisma/client";
import bcrypt from "bcrypt";

/**
 * Development / staging seed. Refuses to run in production: it installs
 * well-known demo credentials and rewrites the template catalogue.
 */

if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_SEED !== "true") {
  console.error("Refusing to seed a production database (set ALLOW_PRODUCTION_SEED=true to override for a first-time catalogue import).");
  process.exit(1);
}

const prisma = new PrismaClient();

/** Account sizes in ETB (≈ $4k, $8k, $20k, $40k at ~125 ETB/USD). */
const ACCOUNT_SIZES = [500_000, 1_000_000, 2_500_000, 5_000_000];
/** Phase-1 challenge fees in ETB per account size. */
const FEES: Record<number, number> = { 500_000: 2_500, 1_000_000: 4_500, 2_500_000: 9_900, 5_000_000: 17_900 };

async function hash(pw: string) {
  return bcrypt.hash(pw, 10);
}

async function main() {
  console.log("Seeding database...");

  // ---------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "Admin12345!ChangeMe";
  const admin = await prisma.user.upsert({
    where: { email: "admin@mellafx.local" },
    update: { emailVerifiedAt: new Date(), ...(process.env.SEED_RESET_DEMO === "true" ? { passwordHash: await hash(adminPassword) } : {}) },
    create: {
      name: "Platform Admin",
      email: "admin@mellafx.local",
      passwordHash: await hash(adminPassword),
      role: "ADMIN",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });
  // A second admin so the payout maker-checker flow can be exercised locally.
  const admin2 = await prisma.user.upsert({
    where: { email: "finance@mellafx.local" },
    update: { emailVerifiedAt: new Date(), ...(process.env.SEED_RESET_DEMO === "true" ? { passwordHash: await hash(adminPassword) } : {}) },
    create: {
      name: "Finance Admin",
      email: "finance@mellafx.local",
      passwordHash: await hash(adminPassword),
      role: "ADMIN",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  const traderSeeds = [
    { name: "Abebe Kebede", email: "alex@mellafx.local", phone: "+251911000001" },
    { name: "Hanna Tesfaye", email: "jamie@mellafx.local", phone: "+251911000002" },
    { name: "Samuel Girma", email: "sam@mellafx.local", phone: "+251911000003" },
    { name: "Tigist Alemu", email: "taylor@mellafx.local", phone: "+251911000004" },
  ];
  const traderPassword = process.env.SEED_TRADER_PASSWORD || "Trader1234!ChangeMe";

  const traders = [];
  for (const t of traderSeeds) {
    const user = await prisma.user.upsert({
      where: { email: t.email },
      update: { emailVerifiedAt: new Date(), ...(process.env.SEED_RESET_DEMO === "true" ? { passwordHash: await hash(traderPassword), phone: t.phone } : {}) },
      create: {
        name: t.name,
        email: t.email,
        phone: t.phone,
        passwordHash: await hash(traderPassword),
        role: "TRADER",
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });
    traders.push(user);
  }

  const demoIds = traders.map((t) => t.id);
  if (process.env.SEED_RESET_DEMO === "true") {
    // Rebuild only the seeded demo traders' activity (never touches other users).
    const accounts = await prisma.tradingAccount.findMany({ where: { userId: { in: demoIds } }, select: { id: true } });
    const accountIds = accounts.map((a) => a.id);
    await prisma.ledgerEntry.deleteMany({ where: { userId: { in: demoIds } } });
    await prisma.order.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.position.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.equitySnapshot.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.trade.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.payout.deleteMany({ where: { userId: { in: demoIds } } });
    await prisma.tradingAccount.updateMany({ where: { id: { in: accountIds } }, data: { previousAccountId: null } });
    await prisma.tradingAccount.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.purchase.deleteMany({ where: { userId: { in: demoIds } } });
    await prisma.kycSubmission.deleteMany({ where: { userId: { in: demoIds } } });
    await prisma.supportTicket.deleteMany({ where: { userId: { in: demoIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: demoIds } } });
    console.log(`Demo activity reset for ${demoIds.length} demo traders.`);
  }

  // ---------------------------------------------------------------------
  // FX rate + instruments
  // ---------------------------------------------------------------------
  const existingRate = await prisma.fxRate.findFirst({ where: { base: "USD", quote: "ETB" } });
  if (!existingRate) {
    await prisma.fxRate.create({ data: { base: "USD", quote: "ETB", rate: 125, source: "SEED" } });
  }
  try {
    const mod = (await import("../src/trading/seedInstruments")) as { ensureDefaultInstruments?: () => Promise<unknown> };
    if (mod.ensureDefaultInstruments) {
      await mod.ensureDefaultInstruments();
      console.log("Instruments ensured.");
    }
  } catch (err) {
    console.warn("Instrument seed skipped:", err instanceof Error ? err.message : err);
  }

  // ---------------------------------------------------------------------
  // Templates: Standard 2-phase program at 4 ETB account sizes, plus a
  // single-phase "Rapid" program with a trailing drawdown.
  // ---------------------------------------------------------------------
  const referenced = await prisma.template.count({ where: { OR: [{ purchases: { some: {} } }, { tradingAccounts: { some: {} } }] } });
  if (referenced === 0) {
    await prisma.template.deleteMany({});
  } else {
    console.log("Templates already referenced by purchases/accounts - archiving old ones instead of deleting.");
    await prisma.template.updateMany({ data: { status: "ARCHIVED", archivedAt: new Date() } });
  }

  const common = { currency: "ETB", accountCurrency: "ETB", dailyLossResetTime: "00:00 EAT" } as const;

  for (const size of ACCOUNT_SIZES) {
    const groupKey = `standard-${size}`;
    const groupName = "Standard 2-Step";
    const label = `${(size / 1_000_000).toFixed(size >= 1_000_000 ? 1 : 2).replace(/\.?0+$/, "")}M ETB`;

    const funded = await prisma.template.create({
      data: {
        ...common,
        name: `Standard ${label} Funded`,
        description: `Funded account of ${label}. 80% profit split, bi-weekly payouts to telebirr, no further evaluation.`,
        price: 0,
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
        drawdownMode: "STATIC",
        dailyDrawdown: 5,
        minTradingDays: 0,
        durationDays: null,
        passingRequirements: "N/A - this is a funded account.",
        failingRequirements: "Breach of the 5% daily loss or 10% maximum loss.",
      },
    });

    const phase2 = await prisma.template.create({
      data: {
        ...common,
        name: `Standard ${label} Phase 2`,
        description: `Verification phase for ${label}. 5% profit target, no time limit.`,
        price: 0,
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
        drawdownMode: "STATIC",
        dailyDrawdown: 5,
        minTradingDays: 3,
        durationDays: null,
        passingRequirements: "Reach the 5% profit target over at least 3 trading days while respecting the loss limits.",
        failingRequirements: "Breach of the 5% daily loss or 10% maximum loss.",
        nextPhaseId: funded.id,
      },
    });

    await prisma.template.create({
      data: {
        ...common,
        name: `Standard ${label} Phase 1`,
        description: `Evaluation for ${label}. 8% profit target, no time limit, fee refunded with your first payout.`,
        price: FEES[size],
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
        drawdownMode: "STATIC",
        dailyDrawdown: 5,
        minTradingDays: 3,
        durationDays: null,
        passingRequirements: "Reach the 8% profit target over at least 3 trading days while respecting the loss limits.",
        failingRequirements: "Breach of the 5% daily loss or 10% maximum loss.",
        nextPhaseId: phase2.id,
      },
    });
  }

  // Rapid single-phase program (trailing drawdown) at the two smallest sizes
  for (const size of [500_000, 1_000_000]) {
    const groupKey = `rapid-${size}`;
    const groupName = "Rapid 1-Step";
    const label = `${(size / 1_000_000).toFixed(size >= 1_000_000 ? 1 : 2).replace(/\.?0+$/, "")}M ETB`;

    const funded = await prisma.template.create({
      data: {
        ...common,
        name: `Rapid ${label} Funded`,
        description: `Funded account for the Rapid ${label} program. 80% profit split.`,
        price: 0,
        status: "ACTIVE",
        phase: "FUNDED",
        programType: "AGGRESSIVE",
        groupName,
        groupKey,
        startingBalance: size,
        accountSize: size,
        leverage: 100,
        profitTarget: null,
        profitSplit: 80,
        maxDrawdown: 6,
        drawdownMode: "TRAILING",
        dailyDrawdown: 4,
        minTradingDays: 0,
        durationDays: null,
        passingRequirements: "N/A - this is a funded account.",
        failingRequirements: "Breach of the 4% daily loss or 6% trailing maximum loss.",
      },
    });

    await prisma.template.create({
      data: {
        ...common,
        name: `Rapid ${label} Challenge`,
        description: `Single-phase evaluation for ${label}. 10% target, 4% daily loss, 6% trailing drawdown.`,
        price: Math.round(FEES[size] * 1.2),
        status: "ACTIVE",
        phase: "PHASE_1",
        programType: "AGGRESSIVE",
        groupName,
        groupKey,
        startingBalance: size,
        accountSize: size,
        leverage: 100,
        profitTarget: 10,
        profitSplit: 80,
        maxDrawdown: 6,
        drawdownMode: "TRAILING",
        dailyDrawdown: 4,
        minTradingDays: 3,
        durationDays: null,
        passingRequirements: "Reach the 10% profit target over at least 3 trading days while respecting the loss limits.",
        failingRequirements: "Breach of the 4% daily loss or 6% trailing maximum loss.",
        nextPhaseId: funded.id,
      },
    });
  }

  await prisma.template.create({
    data: {
      ...common,
      name: "Crypto 500K Challenge (Draft)",
      description: "Upcoming crypto-only challenge program - not yet published.",
      price: 3_000,
      status: "DRAFT",
      phase: "PHASE_1",
      programType: "CRYPTO",
      groupName: "Crypto",
      groupKey: "crypto-500000",
      startingBalance: 500_000,
      accountSize: 500_000,
      leverage: 20,
      profitTarget: 8,
      maxDrawdown: 10,
      dailyDrawdown: 5,
      minTradingDays: 3,
      durationDays: null,
    },
  });

  const templateCount = await prisma.template.count({ where: { status: { not: "ARCHIVED" } } });
  console.log(`Created ${templateCount} templates.`);

  // ---------------------------------------------------------------------
  // Demo purchases + accounts + trades (only when the demo traders have none)
  // ---------------------------------------------------------------------
  const existingAccounts = await prisma.tradingAccount.count({ where: { userId: { in: demoIds } } });
  if (existingAccounts > 0) {
    console.log("Demo accounts already exist - skipping account/trade seed.");
  } else {
    await seedDemoActivity(traders, admin.id);
  }

  await prisma.crmLead.createMany({
    data: [
      { name: "Meron Haile", email: "meron.haile@example.com", status: "NEW", source: "Telegram", value: 2500 },
      { name: "Dawit Bekele", email: "dawit.bekele@example.com", status: "QUALIFIED", source: "Referral", value: 4500 },
      { name: "Selam Yohannes", email: "selam.yohannes@example.com", status: "NEGOTIATION", source: "TikTok", value: 9900 },
      { name: "Yonas Mulu", email: "yonas.mulu@example.com", status: "LOST", source: "Website", value: 2500 },
    ],
    skipDuplicates: true,
  });

  console.log("Seed complete.");
  console.log("----------------------------------------");
  console.log("Admin logins:  admin@mellafx.local and finance@mellafx.local (password: SEED_ADMIN_PASSWORD or the dev default)");
  console.log("Trader logins: alex@mellafx.local, jamie@, sam@, taylor@mellafx.local (password: SEED_TRADER_PASSWORD or the dev default)");
  console.log(`Second admin id for maker-checker demos: ${admin2.id}`);
  console.log("----------------------------------------");
}

async function seedDemoActivity(traders: { id: string; name: string; email: string }[], adminId: string) {
  const phase1Templates = await prisma.template.findMany({ where: { phase: "PHASE_1", status: "ACTIVE" }, include: { nextPhase: { include: { nextPhase: true } } } });

  function snapshotOf(template: Template, next: TemplateSnapshotLike | null): TemplateSnapshotLike {
    return {
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
      drawdownMode: template.drawdownMode,
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
      nextPhaseSnapshot: next,
      snapshotAt: new Date().toISOString(),
    };
  }

  type TemplateSnapshotLike = Record<string, unknown>;

  function fullSnapshot(t: (typeof phase1Templates)[number]): TemplateSnapshotLike {
    const funded = t.nextPhase?.nextPhase ? snapshotOf(t.nextPhase.nextPhase, null) : null;
    const phase2 = t.nextPhase ? snapshotOf(t.nextPhase, funded) : null;
    return snapshotOf(t, phase2);
  }

  async function purchaseAndCreateAccount(userId: string, template: (typeof phase1Templates)[number], daysAgo: number) {
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    const snapshot = fullSnapshot(template);
    const purchase = await prisma.purchase.create({
      data: {
        userId,
        templateId: template.id,
        status: "PAID",
        amount: template.price,
        currency: "ETB",
        providerTxRef: `DEMO-SEED-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        paymentDate: createdAt,
        createdAt,
        snapshot: snapshot as never,
      },
    });
    await prisma.ledgerEntry.create({
      data: { userId, purchaseId: purchase.id, type: "PURCHASE", amount: template.price, currency: "ETB", refType: "Purchase", refId: purchase.id, note: "seed" },
    });
    return prisma.tradingAccount.create({
      data: {
        userId,
        purchaseId: purchase.id,
        templateId: template.id,
        snapshot: snapshot as never,
        phase: template.phase,
        status: "ACTIVE",
        startingBalance: template.startingBalance,
        balance: template.startingBalance,
        equity: template.startingBalance,
        highWaterMark: template.startingBalance,
        dailyAnchorBalance: template.startingBalance,
        // Anchored at creation (in the past): the rules engine / live engine
        // re-anchor to the equity at today's reset boundary on first evaluation,
        // so seeded historical losses never count against today's limit.
        dailyAnchorDate: createdAt,
        createdAt,
        updatedAt: createdAt,
      },
    });
  }

  const symbols = ["EURUSD", "GBPUSD", "XAUUSD", "USDJPY", "BTCUSD"];

  async function seedTrades(accountId: string, startingBalance: number, count: number, winBias: number) {
    let running = 0;
    let wins = 0;
    let losses = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let openTime = new Date(Date.now() - count * 20 * 60 * 60 * 1000);
    for (let i = 0; i < count; i++) {
      const isWin = Math.random() < winBias;
      const pct = (isWin ? 1 : -1) * (0.2 + Math.random() * 1.2);
      const netProfit = Number(((startingBalance * pct) / 100).toFixed(2));
      running += netProfit;
      if (netProfit > 0) {
        wins++;
        grossProfit += netProfit;
      } else {
        losses++;
        grossLoss -= netProfit;
      }
      const closeTime = new Date(openTime.getTime() + (30 + Math.random() * 240) * 60 * 1000);
      const entryPrice = Number((1 + Math.random() * 100).toFixed(4));
      await prisma.trade.create({
        data: {
          accountId,
          symbol: symbols[Math.floor(Math.random() * symbols.length)],
          side: Math.random() > 0.5 ? "BUY" : "SELL",
          volume: Number((0.1 + Math.random() * 2).toFixed(2)),
          entryPrice,
          exitPrice: Number((entryPrice * (1 + pct / 100)).toFixed(4)),
          openTime,
          closeTime,
          profit: netProfit,
          netProfit,
          status: "CLOSED",
          feedSource: "SEED",
        },
      });
      openTime = new Date(openTime.getTime() + (12 + Math.random() * 24) * 60 * 60 * 1000);
    }
    await prisma.tradingAccount.update({
      where: { id: accountId },
      data: {
        balance: startingBalance + running,
        equity: startingBalance + running,
        highWaterMark: startingBalance + Math.max(0, running),
        realizedPnl: running,
        tradeCount: count,
        winCount: wins,
        lossCount: losses,
        grossProfit,
        grossLoss,
        lastTradeAt: new Date(),
      },
    });
    return running;
  }

  // Trader 1: active phase 1, doing well
  const t1 = phase1Templates.find((t) => t.groupKey === "standard-500000")!;
  const acc1 = await purchaseAndCreateAccount(traders[0].id, t1, 12);
  await seedTrades(acc1.id, acc1.startingBalance, 14, 0.62);

  // Trader 2: failed phase 1 (breached drawdown)
  const t2 = phase1Templates.find((t) => t.groupKey === "standard-1000000")!;
  const acc2 = await purchaseAndCreateAccount(traders[1].id, t2, 20);
  const pnl2 = await seedTrades(acc2.id, acc2.startingBalance, 10, 0.3);
  const failedBalance = acc2.startingBalance + Math.min(pnl2, -acc2.startingBalance * 0.11);
  await prisma.tradingAccount.update({
    where: { id: acc2.id },
    data: { balance: failedBalance, equity: failedBalance, realizedPnl: failedBalance - acc2.startingBalance, status: "FAILED", failureReason: "MAX_DRAWDOWN", failedAt: new Date(), statusChangedAt: new Date() },
  });

  // Trader 3: passed phase 1 -> phase 2 -> funded, trading funded, KYC approved
  const t3 = phase1Templates.find((t) => t.groupKey === "standard-2500000")!;
  const acc3Phase1 = await purchaseAndCreateAccount(traders[2].id, t3, 60);
  await seedTrades(acc3Phase1.id, acc3Phase1.startingBalance, 12, 0.7);
  await prisma.tradingAccount.update({
    where: { id: acc3Phase1.id },
    data: { status: "PASSED", passedAt: new Date(Date.now() - 40 * 86_400_000), balance: acc3Phase1.startingBalance * 1.08, equity: acc3Phase1.startingBalance * 1.08, realizedPnl: acc3Phase1.startingBalance * 0.08 },
  });
  const phase2Template = t3.nextPhase;
  const fundedTemplate = t3.nextPhase?.nextPhase;
  if (phase2Template && fundedTemplate) {
    const snapshot = fullSnapshot(t3) as { nextPhaseSnapshot?: { nextPhaseSnapshot?: unknown } };
    const acc3Phase2 = await prisma.tradingAccount.create({
      data: {
        userId: traders[2].id,
        templateId: phase2Template.id,
        previousAccountId: acc3Phase1.id,
        snapshot: (snapshot.nextPhaseSnapshot ?? {}) as never,
        phase: "PHASE_2",
        status: "PASSED",
        startingBalance: phase2Template.startingBalance,
        balance: phase2Template.startingBalance * 1.06,
        equity: phase2Template.startingBalance * 1.06,
        highWaterMark: phase2Template.startingBalance * 1.06,
        dailyAnchorBalance: phase2Template.startingBalance,
        realizedPnl: phase2Template.startingBalance * 0.06,
        passedAt: new Date(Date.now() - 20 * 86_400_000),
        createdAt: new Date(Date.now() - 38 * 86_400_000),
      },
    });
    const acc3Funded = await prisma.tradingAccount.create({
      data: {
        userId: traders[2].id,
        templateId: fundedTemplate.id,
        previousAccountId: acc3Phase2.id,
        snapshot: (snapshot.nextPhaseSnapshot?.nextPhaseSnapshot ?? {}) as never,
        phase: "FUNDED",
        status: "FUNDED",
        startingBalance: fundedTemplate.startingBalance,
        balance: fundedTemplate.startingBalance,
        equity: fundedTemplate.startingBalance,
        highWaterMark: fundedTemplate.startingBalance,
        dailyAnchorBalance: fundedTemplate.startingBalance,
        fundedAt: new Date(Date.now() - 20 * 86_400_000),
        createdAt: new Date(Date.now() - 20 * 86_400_000),
      },
    });
    await seedTrades(acc3Funded.id, acc3Funded.startingBalance, 20, 0.65);
  }

  // Trader 4: fresh account, no trades yet
  const t4 = phase1Templates.find((t) => t.groupKey === "rapid-500000")!;
  await purchaseAndCreateAccount(traders[3].id, t4, 1);

  // KYC submissions
  await prisma.kycSubmission.createMany({
    data: [
      { userId: traders[2].id, fullName: traders[2].name, country: "Ethiopia", documentType: "Fayda ID", status: "APPROVED", provider: "MANUAL", submittedAt: new Date(Date.now() - 25 * 86_400_000), reviewedAt: new Date(Date.now() - 24 * 86_400_000), reviewerId: adminId, notes: "Verified against Fayda ID." },
      { userId: traders[0].id, fullName: traders[0].name, country: "Ethiopia", documentType: "Fayda ID", status: "APPROVED", provider: "MANUAL", submittedAt: new Date(Date.now() - 10 * 86_400_000), reviewedAt: new Date(Date.now() - 9 * 86_400_000), reviewerId: adminId, notes: "Verified." },
      { userId: traders[1].id, fullName: traders[1].name, country: "Ethiopia", documentType: "Fayda ID", status: "PENDING", provider: "MANUAL", submittedAt: new Date(Date.now() - 2 * 86_400_000) },
    ],
  });

  await prisma.supportTicket.create({
    data: { userId: traders[1].id, subject: "Question about daily loss reset time", message: "What time does the daily loss limit reset?", status: "OPEN" },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
