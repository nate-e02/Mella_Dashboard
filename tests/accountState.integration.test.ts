import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { computeAccountState, listUserAccountStates } from "@/lib/services/accountState";
import { getBars } from "@/lib/services/market";
import { TestFixtures } from "./helpers/fixtures";

/**
 * Runs against the local dev database (see vitest.config.ts). Every row is
 * uniquely named and removed afterwards; Position/Instrument/Bar rows are not
 * covered by TestFixtures.cleanup(), so they are tracked and deleted here.
 */

const fixtures = new TestFixtures();
const createdPositionIds: string[] = [];
const createdInstrumentSymbols: string[] = [];
const createdBarSymbols: string[] = [];

afterEach(async () => {
  if (createdPositionIds.length) {
    await prisma.position.deleteMany({ where: { id: { in: createdPositionIds } } });
    createdPositionIds.length = 0;
  }
  await fixtures.cleanup();
  if (createdBarSymbols.length) {
    await prisma.bar.deleteMany({ where: { symbol: { in: createdBarSymbols } } });
    createdBarSymbols.length = 0;
  }
  if (createdInstrumentSymbols.length) {
    await prisma.instrument.deleteMany({ where: { symbol: { in: createdInstrumentSymbols } } });
    createdInstrumentSymbols.length = 0;
  }
});

async function createTestInstrument() {
  const symbol = `VT${Date.now().toString(36).toUpperCase().slice(-6)}${Math.floor(Math.random() * 100)}`.slice(0, 12);
  const instrument = await prisma.instrument.create({
    data: { symbol, displayName: `Vitest ${symbol}`, baseCurrency: "EUR", quoteCurrency: "USD", feedSymbol: symbol, enabled: false, sortOrder: 9999 },
  });
  createdInstrumentSymbols.push(symbol);
  return instrument;
}

describe("computeAccountState", () => {
  it("reflects closed trades and open positions in balance, equity, daily loss and drawdown", async () => {
    const user = await fixtures.createUser();
    // 10,000 start, 10% max DD (static) => floor 9,000; 5% daily => limit 500 from a 10,000 anchor.
    const template = await fixtures.createTemplate({ startingBalance: 10000, maxDrawdown: 10, dailyDrawdown: 5, profitTarget: 8, minTradingDays: 3 });
    const account = await fixtures.createAccount({ userId: user.id, template });
    const instrument = await createTestInstrument();

    await fixtures.addClosedTrade(account.id, -200);
    const position = await prisma.position.create({
      data: {
        accountId: account.id,
        symbol: instrument.symbol,
        side: "BUY",
        volume: 0.5,
        entryPrice: 1.1,
        currentPrice: 1.099,
        floatingPnl: -50,
        marginUsed: 550,
        stopLoss: 1.09,
        takeProfit: null,
        status: "OPEN",
      },
    });
    createdPositionIds.push(position.id);

    const state = await computeAccountState(account.id);

    expect(state.accountId).toBe(account.id);
    expect(state.currency).toBe("ETB");
    expect(state.status).toBe("ACTIVE");
    expect(state.balance).toBe(9800); // 10,000 - 200 realized
    expect(state.realizedPnl).toBe(-200);
    expect(state.floatingPnl).toBe(-50);
    expect(state.equity).toBe(9750); // balance + floating
    expect(state.marginUsed).toBe(550);
    expect(state.freeMargin).toBe(9200);

    expect(state.dailyAnchor).toBe(10000);
    expect(state.dailyLossLimit).toBe(500);
    expect(state.dailyLossUsed).toBe(250); // anchor - equity

    expect(state.drawdownFloor).toBe(9000);
    expect(state.drawdownRemaining).toBe(750); // equity - floor

    expect(state.profitTarget).toBe(800);
    expect(state.profitProgress).toBe(0); // negative realized clamps to 0
    expect(state.tradingDays).toBe(1);
    expect(state.minTradingDays).toBe(3);

    expect(state.positions).toHaveLength(1);
    expect(state.positions[0]).toMatchObject({
      id: position.id,
      accountId: account.id,
      symbol: instrument.symbol,
      side: "BUY",
      volume: 0.5,
      entryPrice: 1.1,
      currentPrice: 1.099,
      stopLoss: 1.09,
      takeProfit: null,
      floatingPnl: -50,
      marginUsed: 550,
    });
    expect(typeof state.positions[0].openedAt).toBe("string");
  });

  it("never reports negative daily loss when equity is above the anchor, and tracks target progress", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ startingBalance: 10000, profitTarget: 10, dailyDrawdown: 5, maxDrawdown: 10 });
    const account = await fixtures.createAccount({ userId: user.id, template });
    await fixtures.addClosedTrade(account.id, 400);

    const state = await computeAccountState(account.id);

    expect(state.balance).toBe(10400);
    expect(state.equity).toBe(10400);
    expect(state.dailyLossUsed).toBe(0);
    expect(state.profitTarget).toBe(1000);
    expect(state.profitProgress).toBeCloseTo(40, 6);
    expect(state.positions).toEqual([]);
  });

  it("uses the trailing high-water mark for TRAILING drawdown accounts", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ startingBalance: 10000, maxDrawdown: 10, drawdownMode: "TRAILING" });
    const account = await fixtures.createAccount({ userId: user.id, template, highWaterMark: 10500 });

    const state = await computeAccountState(account.id);

    // trailing floor = min(hwm - 1000, startingBalance) = 9,500
    expect(state.drawdownFloor).toBe(9500);
    expect(state.drawdownRemaining).toBe(500);
  });

  it("lists every account of a user newest first with metadata", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ name: "Vitest Objectives" });
    const older = await fixtures.createAccount({ userId: user.id, template, status: "FAILED" });
    await new Promise((r) => setTimeout(r, 5));
    const newer = await fixtures.createAccount({ userId: user.id, template });

    const entries = await listUserAccountStates(user.id);

    expect(entries.map((e) => e.meta.id)).toEqual([newer.id, older.id]);
    expect(entries[0].meta.tradable).toBe(true);
    expect(entries[1].meta.tradable).toBe(false);
    expect(entries[0].meta.name).toBe("Vitest Objectives");
    expect(entries[0].meta.leverage).toBe(template.leverage);
    expect(entries[0].state.balance).toBe(template.startingBalance);
  });
});

describe("getBars aggregation", () => {
  it("aggregates 12 one-minute bars into three 5m buckets with correct OHLC and volume", async () => {
    const symbol = `VT${Date.now()}`.slice(0, 12);
    createdBarSymbols.push(symbol);
    const base = Date.UTC(2026, 8, 23, 10, 0, 0); // 10:00:00Z, a 5m boundary

    // Minute i: open 1.1000+i, close open+0.5, high open+1, low open-1 (in "price units" of 0.0001), volume 10+i.
    const rows = Array.from({ length: 12 }, (_, i) => {
      const open = 1.1 + i * 0.0001;
      return {
        symbol,
        timeframe: "1m",
        time: new Date(base + i * 60_000),
        open,
        high: open + 0.0001,
        low: open - 0.0001,
        close: open + 0.00005,
        volume: 10 + i,
      };
    });
    await prisma.bar.createMany({ data: rows });

    const bars = await getBars(symbol, "5m", { limit: 500 });

    expect(bars).toHaveLength(3);
    expect(bars.map((b) => b.time)).toEqual([base / 1000, base / 1000 + 300, base / 1000 + 600]);

    // Bucket 1: minutes 0..4
    expect(bars[0].open).toBeCloseTo(rows[0].open, 10);
    expect(bars[0].close).toBeCloseTo(rows[4].close, 10);
    expect(bars[0].high).toBeCloseTo(rows[4].high, 10);
    expect(bars[0].low).toBeCloseTo(rows[0].low, 10);
    expect(bars[0].volume).toBe(10 + 11 + 12 + 13 + 14);

    // Bucket 2: minutes 5..9
    expect(bars[1].open).toBeCloseTo(rows[5].open, 10);
    expect(bars[1].close).toBeCloseTo(rows[9].close, 10);
    expect(bars[1].high).toBeCloseTo(rows[9].high, 10);
    expect(bars[1].low).toBeCloseTo(rows[5].low, 10);
    expect(bars[1].volume).toBe(15 + 16 + 17 + 18 + 19);

    // Bucket 3: minutes 10..11 (partial bucket)
    expect(bars[2].open).toBeCloseTo(rows[10].open, 10);
    expect(bars[2].close).toBeCloseTo(rows[11].close, 10);
    expect(bars[2].volume).toBe(20 + 21);

    // 1m passthrough and `before` paging on the aggregated timeframe.
    const oneMinute = await getBars(symbol, "1m", { limit: 5 });
    expect(oneMinute).toHaveLength(5);
    expect(oneMinute[0].time).toBe(base / 1000 + 7 * 60); // the 5 most recent minutes, ascending
    expect(oneMinute[4].time).toBe(base / 1000 + 11 * 60);

    const earlier = await getBars(symbol, "5m", { limit: 500, before: new Date(base + 600_000) });
    expect(earlier.map((b) => b.time)).toEqual([base / 1000, base / 1000 + 300]);

    const limited = await getBars(symbol, "5m", { limit: 2 });
    expect(limited.map((b) => b.time)).toEqual([base / 1000 + 300, base / 1000 + 600]);
  });
});
