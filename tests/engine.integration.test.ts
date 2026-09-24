import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { TradingBus } from "@/trading/bus";
import { Engine } from "@/trading/engine";
import { Converter } from "@/trading/fx";
import type { AccountState, ServerMessage, Tick } from "@/trading/protocol";
import { TestFixtures } from "./helpers/fixtures";

/**
 * Drives the live engine against the local Postgres database with synthetic
 * ticks (no feed, no sockets): fills, mark-to-market persistence, TP close
 * through the ledger, daily-loss breach, idempotent client order ids and the
 * market-halt guard.
 */

const fixtures = new TestFixtures();
const SYMBOL = `VT${Date.now().toString(36).toUpperCase()}`;
const USD_ETB = 100;

const silent = { info() {}, warn() {}, error() {}, debug() {} };
let clock = Date.now();
let bus: TradingBus;
let engine: Engine;
const accountIds: string[] = [];
const accountEvents: AccountState[] = [];

function tick(bid: number, ask: number): Tick {
  clock += 100;
  return { symbol: SYMBOL, bid, ask, ts: clock, source: "TEST" };
}

function orderResult(replies: ServerMessage[]) {
  const r = replies.find((m) => m.type === "order.result");
  if (!r || r.type !== "order.result") throw new Error(`no order.result in ${JSON.stringify(replies)}`);
  return r;
}

beforeAll(async () => {
  await prisma.instrument.create({
    data: {
      symbol: SYMBOL,
      displayName: "Vitest pair",
      category: "FOREX",
      baseCurrency: "EUR",
      quoteCurrency: "USD",
      digits: 5,
      contractSize: 100_000,
      minVolume: 0.01,
      maxVolume: 50,
      volumeStep: 0.01,
      commissionPerLot: 100, // 100 ETB per lot -> 1 ETB on 0.01 lot
      feedSource: "STUB",
      feedSymbol: SYMBOL,
      enabled: true,
    },
  });
  bus = new TradingBus();
  bus.on("account", (a) => accountEvents.push(a));
  const fx = new Converter("ETB");
  fx.setUsdRate(USD_ETB, "MANUAL");
  engine = new Engine({ bus, fx, log: silent, now: () => clock, loadAccountsOnStart: false });
  await engine.start();
});

afterAll(async () => {
  await engine.stop();
  await bus.close();
  if (accountIds.length > 0) {
    await prisma.ledgerEntry.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.order.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.position.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.equitySnapshot.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.auditLog.deleteMany({ where: { targetType: "TradingAccount", targetId: { in: accountIds } } });
  }
  await prisma.bar.deleteMany({ where: { symbol: SYMBOL } });
  await fixtures.cleanup();
  await prisma.instrument.delete({ where: { symbol: SYMBOL } });
});

async function createTrackedAccount(overrides: { maxDrawdown?: number; dailyDrawdown?: number } = {}) {
  const user = await fixtures.createUser();
  const template = await fixtures.createTemplate({ maxDrawdown: overrides.maxDrawdown ?? 50, dailyDrawdown: overrides.dailyDrawdown ?? 5, leverage: 100, profitTarget: 8 });
  const account = await fixtures.createAccount({ userId: user.id, template });
  accountIds.push(account.id);
  const tracked = await engine.reloadAccount(account.id);
  expect(tracked?.id).toBe(account.id);
  return { user, account };
}

describe("engine (integration)", () => {
  it("fills a market order, marks to market, closes at take-profit through the ledger, and de-duplicates clientOrderId", async () => {
    const { user, account } = await createTrackedAccount();
    const ctx = { userId: user.id, role: "TRADER" };

    engine.onTick(tick(1.1, 1.1001));
    expect(engine.marketStatus().state).toBe("OPEN");

    // --- market BUY 0.01 with SL/TP ---
    const placed = orderResult(
      await engine.handle(ctx, { type: "order.place", accountId: account.id, clientOrderId: "c-1", symbol: SYMBOL, side: "BUY", orderType: "MARKET", volume: 0.01, stopLoss: 1.09, takeProfit: 1.105 }),
    );
    expect(placed.status).toBe("FILLED");
    expect(placed.filledPrice).toBe(1.1001);
    const positionId = placed.positionId!;

    const posRow = await prisma.position.findUniqueOrThrow({ where: { id: positionId } });
    expect(posRow.status).toBe("OPEN");
    expect(posRow.entryPrice).toBe(1.1001);
    expect(posRow.marginUsed).toBe(1100.1); // 1000 * 1.1001 * 100 ETB / 100 leverage
    const orderRow = await prisma.order.findUniqueOrThrow({ where: { accountId_clientOrderId: { accountId: account.id, clientOrderId: "c-1" } } });
    expect(orderRow.status).toBe("FILLED");
    expect(orderRow.positionId).toBe(positionId);
    let acctRow = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(acctRow.marginUsed).toBe(1100.1);

    // --- price moves +10 pips: floating = 1 USD = 100 ETB, persisted on flush ---
    engine.onTick(tick(1.1011, 1.1012));
    await engine.flush();
    const marked = await prisma.position.findUniqueOrThrow({ where: { id: positionId } });
    expect(marked.floatingPnl).toBe(100);
    expect(marked.currentPrice).toBe(1.1011);
    acctRow = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(acctRow.equity).toBe(10100);
    const state = engine.getAccountState(account.id)!;
    expect(state.equity).toBe(10100);
    expect(state.freeMargin).toBe(8999.9);
    expect(state.dailyLossLimit).toBe(500);
    expect(state.drawdownFloor).toBe(5000);

    // --- take-profit: bid reaches 1.105 -> closes at exactly 1.105 ---
    engine.onTick(tick(1.105, 1.1051));
    await engine.idle();
    const closed = await prisma.position.findUniqueOrThrow({ where: { id: positionId } });
    expect(closed.status).toBe("CLOSED");
    expect(closed.closeReason).toBe("TAKE_PROFIT");
    expect(closed.closePrice).toBe(1.105);
    const trade = await prisma.trade.findFirstOrThrow({ where: { positionId } });
    expect(trade.exitPrice).toBe(1.105);
    expect(trade.profit).toBe(490); // (1.105 - 1.1001) * 1000 = 4.9 USD * 100
    expect(trade.commission).toBe(1);
    expect(trade.netProfit).toBe(489);
    expect(trade.quoteCurrency).toBe("USD");
    expect(trade.fxRate).toBe(USD_ETB);
    expect(trade.closeReason).toBe("TAKE_PROFIT");
    const ledger = await prisma.ledgerEntry.findMany({ where: { accountId: account.id } });
    expect(ledger.map((l) => [l.type, l.amount]).sort()).toEqual([
      ["COMMISSION", -1],
      ["TRADE_PNL", 490],
    ]);
    acctRow = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(acctRow.balance).toBe(10489);
    expect(acctRow.realizedPnl).toBe(489);
    expect(acctRow.marginUsed).toBe(0);
    expect(acctRow.status).toBe("ACTIVE");
    expect(engine.getAccountState(account.id)!.positions).toHaveLength(0);

    // --- duplicate clientOrderId -> a single position ---
    const first = orderResult(await engine.handle(ctx, { type: "order.place", accountId: account.id, clientOrderId: "dup-1", symbol: SYMBOL, side: "SELL", orderType: "MARKET", volume: 0.02 }));
    const second = orderResult(await engine.handle(ctx, { type: "order.place", accountId: account.id, clientOrderId: "dup-1", symbol: SYMBOL, side: "SELL", orderType: "MARKET", volume: 0.02 }));
    expect(first.status).toBe("FILLED");
    expect(second.status).toBe("FILLED");
    expect(second.positionId).toBe(first.positionId);
    expect(await prisma.position.count({ where: { accountId: account.id, status: "OPEN" } })).toBe(1);
    expect(engine.getAccountState(account.id)!.positions).toHaveLength(1);

    // --- partial close of 0.01 out of 0.02 ---
    engine.onTick(tick(1.104, 1.1041));
    const replies = await engine.handle(ctx, { type: "position.close", accountId: account.id, positionId: first.positionId!, volume: 0.01 });
    expect(replies).toEqual([]);
    const partial = await prisma.position.findUniqueOrThrow({ where: { id: first.positionId! } });
    expect(partial.status).toBe("OPEN");
    expect(partial.volume).toBe(0.01);
    expect(await prisma.trade.count({ where: { positionId: first.positionId!, closeReason: "MANUAL" } })).toBe(1);

    // --- ownership: another user cannot touch it ---
    const stranger = await fixtures.createUser();
    const denied = await engine.handle({ userId: stranger.id, role: "TRADER" }, { type: "position.close", accountId: account.id, positionId: first.positionId! });
    expect(denied[0]).toMatchObject({ type: "error", code: "NOT_FOUND" });

    // --- full close ---
    await engine.handle(ctx, { type: "position.close", accountId: account.id, positionId: first.positionId! });
    expect((await prisma.position.findUniqueOrThrow({ where: { id: first.positionId! } })).status).toBe("CLOSED");
    expect((await prisma.tradingAccount.findUniqueOrThrow({ where: { id: account.id } })).marginUsed).toBe(0);
  });

  it("rejects orders while the market is halted and records the rejection", async () => {
    const { user, account } = await createTrackedAccount();
    engine.onTick(tick(1.1, 1.1001));
    clock += 6_000; // beyond FEED_STALE_MS with no tick
    engine.refreshMarketState();
    expect(engine.marketStatus().state).toBe("HALTED");
    const r = orderResult(await engine.handle({ userId: user.id, role: "TRADER" }, { type: "order.place", accountId: account.id, clientOrderId: "halt-1", symbol: SYMBOL, side: "BUY", orderType: "MARKET", volume: 0.01 }));
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("MARKET_HALTED");
    const row = await prisma.order.findUniqueOrThrow({ where: { accountId_clientOrderId: { accountId: account.id, clientOrderId: "halt-1" } } });
    expect(row.status).toBe("REJECTED");
    expect(row.rejectReason).toMatch(/^MARKET_HALTED/);
    engine.onTick(tick(1.1, 1.1001));
    expect(engine.marketStatus().state).toBe("OPEN");
    expect(await prisma.position.count({ where: { accountId: account.id } })).toBe(0);
  });

  it("rejects volume/margin/stop violations", async () => {
    const { user, account } = await createTrackedAccount();
    const ctx = { userId: user.id, role: "TRADER" };
    engine.onTick(tick(1.1, 1.1001));
    const bad = (clientOrderId: string, extra: Record<string, unknown>) =>
      engine.handle(ctx, { type: "order.place", accountId: account.id, clientOrderId, symbol: SYMBOL, side: "BUY", orderType: "MARKET", volume: 0.01, ...extra } as never).then(orderResult);
    expect((await bad("v-1", { volume: 0.015 })).reason).toBe("INVALID_VOLUME");
    expect((await bad("v-2", { volume: 1 })).reason).toBe("INSUFFICIENT_MARGIN"); // 110010 ETB needed on a 10000 account
    expect((await bad("v-3", { stopLoss: 1.2 })).reason).toBe("INVALID_STOP_LOSS");
    expect((await bad("v-4", { takeProfit: 1.0 })).reason).toBe("INVALID_TAKE_PROFIT");
    expect((await bad("v-5", { symbol: "NOPE" })).reason).toBe("UNKNOWN_SYMBOL");
    // The unknown-symbol rejection cannot be recorded (Order.symbol references Instrument).
    expect(await prisma.order.count({ where: { accountId: account.id, status: "REJECTED" } })).toBe(4);
    expect((await prisma.order.findUniqueOrThrow({ where: { accountId_clientOrderId: { accountId: account.id, clientOrderId: "v-2" } } })).rejectReason).toMatch(/^INSUFFICIENT_MARGIN/);
  });

  it("closes everything with reason BREACH and fails the account on a daily-loss breach", async () => {
    const { user, account } = await createTrackedAccount({ maxDrawdown: 50, dailyDrawdown: 5 }); // daily floor 9500, dd floor 5000
    const ctx = { userId: user.id, role: "TRADER" };
    engine.onTick(tick(1.1, 1.1001));
    const a = orderResult(await engine.handle(ctx, { type: "order.place", accountId: account.id, clientOrderId: "b-1", symbol: SYMBOL, side: "BUY", orderType: "MARKET", volume: 0.01 }));
    const b = orderResult(await engine.handle(ctx, { type: "order.place", accountId: account.id, clientOrderId: "b-2", symbol: SYMBOL, side: "BUY", orderType: "MARKET", volume: 0.01 }));
    expect(a.status).toBe("FILLED");
    expect(b.status).toBe("FILLED");

    // -60 pips on 2 x 0.01 lot = -12 USD = -1200 ETB -> equity 8800 <= 9500
    engine.onTick(tick(1.0941, 1.0942));
    await engine.idle();

    const positions = await prisma.position.findMany({ where: { accountId: account.id } });
    expect(positions).toHaveLength(2);
    for (const p of positions) {
      expect(p.status).toBe("CLOSED");
      expect(p.closeReason).toBe("BREACH");
      expect(p.closePrice).toBe(1.0941);
    }
    const acct = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(acct.status).toBe("FAILED");
    expect(acct.failureReason).toBe("DAILY_LOSS");
    expect(acct.marginUsed).toBe(0);
    expect(acct.balance).toBe(8798); // 10000 - 1200 - 2 commission
    expect(engine.getAccountState(account.id)).toBeNull(); // untracked
    const last = [...accountEvents].reverse().find((e) => e.accountId === account.id)!;
    expect(last.status).toBe("FAILED");

    // Further orders are refused without touching the DB.
    const after = orderResult(await engine.handle(ctx, { type: "order.place", accountId: account.id, clientOrderId: "b-3", symbol: SYMBOL, side: "BUY", orderType: "MARKET", volume: 0.01 }));
    expect(after.status).toBe("REJECTED");
    expect(after.reason).toBe("ACCOUNT_NOT_TRADABLE");
  });

  it("triggers a pending BUY LIMIT through the existing order row", async () => {
    const { user, account } = await createTrackedAccount();
    const ctx = { userId: user.id, role: "TRADER" };
    engine.onTick(tick(1.1, 1.1001));
    const pending = orderResult(await engine.handle(ctx, { type: "order.place", accountId: account.id, clientOrderId: "l-1", symbol: SYMBOL, side: "BUY", orderType: "LIMIT", price: 1.095, volume: 0.01 }));
    expect(pending.status).toBe("PENDING");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: pending.orderId! } })).status).toBe("PENDING");
    engine.onTick(tick(1.0951, 1.0952)); // ask above limit: no fill
    await engine.idle();
    expect(await prisma.position.count({ where: { accountId: account.id } })).toBe(0);
    engine.onTick(tick(1.0948, 1.0949)); // ask <= 1.095 -> fill at the limit price
    await engine.idle();
    const order = await prisma.order.findUniqueOrThrow({ where: { id: pending.orderId! } });
    expect(order.status).toBe("FILLED");
    expect(order.filledPrice).toBe(1.0949);
    const pos = await prisma.position.findUniqueOrThrow({ where: { id: order.positionId! } });
    expect(pos.status).toBe("OPEN");
    expect(pos.entryPrice).toBe(1.0949);
    expect(engine.getAccountState(account.id)!.positions.map((p) => p.id)).toEqual([pos.id]);
    await engine.handle(ctx, { type: "position.close", accountId: account.id, positionId: pos.id });
  });
});
