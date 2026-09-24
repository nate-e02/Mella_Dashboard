import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { TradingBus } from "@/trading/bus";
import { Engine } from "@/trading/engine";
import { NEWS_WINDOW_SETTING } from "@/trading/news";
import { Converter } from "@/trading/fx";
import type { ClientMessage, ServerMessage } from "@/trading/protocol";
import { TestFixtures } from "./helpers/fixtures";

/**
 * Challenge holding and news rules, driven through the live engine with a
 * fake clock and injected ticks: weekend flattening at Friday 16:45 New York,
 * overnight flattening at 16:55 New York, the rejections in between, the
 * crypto exemption, and the news window (orders refused, pending orders held,
 * stop-losses still honoured).
 */

const fixtures = new TestFixtures();
const suffix = Date.now().toString(36).toUpperCase();
const FX = `VRF${suffix}`;
const CRYPTO = `VRC${suffix}`;
const NEWSY = `VRN${suffix}`;
// A made-up currency so no other event in the database can touch this instrument.
const NEWS_CCY = `Z${suffix.slice(-2)}`;
const silent = { info() {}, warn() {}, error() {}, debug() {} };

let clock = 0;
let bus: TradingBus;
let engine: Engine;
const accountIds: string[] = [];
const eventIds: string[] = [];
let previousWindowSetting: unknown = undefined;

const at = (iso: string) => new Date(iso).getTime();

/** Advances the clock by 100 ms and feeds a fresh tick for every test instrument (keeps the market OPEN). */
function tickAll(prices: Partial<Record<string, [number, number]>> = {}) {
  clock += 100;
  const defaults: Record<string, [number, number]> = { [FX]: [1.1, 1.1001], [CRYPTO]: [60_000, 60_010], [NEWSY]: [2, 2.0002] };
  for (const [symbol, quote] of Object.entries({ ...defaults, ...prices })) engine.onTick({ symbol, bid: quote![0], ask: quote![1], ts: clock, source: "TEST" });
}

/** Ticks every instrument so that the clock ends exactly at `ms`. */
function setClock(ms: number, prices: Partial<Record<string, [number, number]>> = {}) {
  clock = ms - 100;
  tickAll(prices);
}

async function order(user: { id: string }, accountId: string, clientOrderId: string, symbol: string, extra: Partial<Extract<ClientMessage, { type: "order.place" }>> = {}) {
  const replies: ServerMessage[] = await engine.handle(
    { userId: user.id, role: "TRADER" },
    { type: "order.place", accountId, clientOrderId, symbol, side: "BUY", orderType: "MARKET", volume: 0.01, ...extra },
  );
  const r = replies.find((m) => m.type === "order.result");
  if (!r || r.type !== "order.result") throw new Error(`no order.result: ${JSON.stringify(replies)}`);
  return r;
}

async function account(rules: { weekendHoldingAllowed?: boolean; overnightHoldingAllowed?: boolean; newsTradingAllowed?: boolean }) {
  const user = await fixtures.createUser();
  const template = await fixtures.createTemplate({ maxDrawdown: 50, dailyDrawdown: 40, leverage: 100, profitTarget: 50, ...rules });
  const acct = await fixtures.createAccount({ userId: user.id, template, startingBalance: 1_000_000, balance: 1_000_000, equity: 1_000_000, highWaterMark: 1_000_000, dailyAnchorBalance: 1_000_000 });
  accountIds.push(acct.id);
  expect((await engine.reloadAccount(acct.id))?.id).toBe(acct.id);
  return { user, acct };
}

beforeAll(async () => {
  const base = { contractSize: 100_000, minVolume: 0.01, maxVolume: 50, volumeStep: 0.01, feedSource: "STUB", enabled: true } as const;
  await prisma.instrument.createMany({
    data: [
      { ...base, symbol: FX, displayName: "Rules FX", category: "FOREX", baseCurrency: "EUR", quoteCurrency: "USD", digits: 5, feedSymbol: FX },
      { ...base, symbol: CRYPTO, displayName: "Rules crypto", category: "CRYPTO", baseCurrency: "BTC", quoteCurrency: "USD", digits: 2, contractSize: 1, feedSymbol: CRYPTO },
      { ...base, symbol: NEWSY, displayName: "Rules news", category: "FOREX", baseCurrency: NEWS_CCY, quoteCurrency: "USD", digits: 4, feedSymbol: NEWSY },
    ],
  });
  const existing = await prisma.systemSetting.findUnique({ where: { key: NEWS_WINDOW_SETTING } });
  previousWindowSetting = existing?.value;
  await prisma.systemSetting.upsert({ where: { key: NEWS_WINDOW_SETTING }, create: { key: NEWS_WINDOW_SETTING, value: 2 }, update: { value: 2 } });

  bus = new TradingBus();
  const fx = new Converter("ETB");
  fx.setUsdRate(100, "MANUAL");
  clock = at("2026-09-25T20:40:00Z");
  engine = new Engine({ bus, fx, log: silent, now: () => clock, loadAccountsOnStart: false });
  await engine.start();
});

afterAll(async () => {
  await engine.stop();
  await bus.close();
  await prisma.economicEvent.deleteMany({ where: { id: { in: eventIds } } });
  if (previousWindowSetting === undefined) await prisma.systemSetting.deleteMany({ where: { key: NEWS_WINDOW_SETTING } });
  else await prisma.systemSetting.update({ where: { key: NEWS_WINDOW_SETTING }, data: { value: previousWindowSetting as never } });
  if (accountIds.length > 0) await prisma.auditLog.deleteMany({ where: { targetType: "TradingAccount", targetId: { in: accountIds } } });
  await fixtures.cleanup();
  await prisma.bar.deleteMany({ where: { symbol: { in: [FX, CRYPTO, NEWSY] } } });
  await prisma.instrument.deleteMany({ where: { symbol: { in: [FX, CRYPTO, NEWSY] } } });
});

describe("weekend holding rule", () => {
  it("flattens non-crypto positions at Friday 16:45 New York once, cancels FX pending orders, and refuses FX orders until the Sunday open", async () => {
    setClock(at("2026-09-25T20:40:00Z")); // Friday 16:40 EDT
    const strict = await account({ weekendHoldingAllowed: false });
    const relaxed = await account({ weekendHoldingAllowed: true });

    const fxPos = await order(strict.user, strict.acct.id, "w-fx", FX);
    const cryptoPos = await order(strict.user, strict.acct.id, "w-crypto", CRYPTO);
    const relaxedPos = await order(relaxed.user, relaxed.acct.id, "w-relaxed", FX);
    const fxLimit = await order(strict.user, strict.acct.id, "w-fx-limit", FX, { orderType: "LIMIT", price: 1.05 });
    const cryptoLimit = await order(strict.user, strict.acct.id, "w-crypto-limit", CRYPTO, { orderType: "LIMIT", price: 50_000 });
    for (const r of [fxPos, cryptoPos, relaxedPos]) expect(r.status).toBe("FILLED");
    expect(fxLimit.status).toBe("PENDING");
    expect(cryptoLimit.status).toBe("PENDING");

    // 16:44:59 - nothing yet.
    setClock(at("2026-09-25T20:44:59Z"));
    engine.runSecondTick();
    await engine.idle();
    expect((await prisma.position.findUniqueOrThrow({ where: { id: fxPos.positionId! } })).status).toBe("OPEN");

    // 16:45:00 - the cutoff.
    setClock(at("2026-09-25T20:45:00Z"));
    engine.runSecondTick();
    await engine.idle();
    const closedFx = await prisma.position.findUniqueOrThrow({ where: { id: fxPos.positionId! } });
    expect(closedFx.status).toBe("CLOSED");
    expect(closedFx.closeReason).toBe("WEEKEND");
    expect(closedFx.closePrice).toBe(1.1);
    const trade = await prisma.trade.findFirstOrThrow({ where: { positionId: fxPos.positionId! } });
    expect(trade.closeReason).toBe("WEEKEND");
    expect(trade.netProfit).toBe(-10); // 1 pip spread on 0.01 lot = 0.1 USD = 10 ETB
    expect((await prisma.position.findUniqueOrThrow({ where: { id: cryptoPos.positionId! } })).status).toBe("OPEN");
    expect((await prisma.position.findUniqueOrThrow({ where: { id: relaxedPos.positionId! } })).status).toBe("OPEN");
    const fxOrder = await prisma.order.findUniqueOrThrow({ where: { id: fxLimit.orderId! } });
    expect(fxOrder.status).toBe("CANCELLED");
    expect(fxOrder.rejectReason).toBe("WEEKEND_CLOSED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: cryptoLimit.orderId! } })).status).toBe("PENDING");
    const acctRow = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: strict.acct.id } });
    expect(acctRow.balance).toBe(999_990);
    expect(engine.getAccountState(strict.acct.id)!.positions.map((p) => p.symbol)).toEqual([CRYPTO]);

    const notes = await prisma.notification.findMany({ where: { userId: strict.user.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe("Positions closed for the weekend");
    expect(notes[0].message).toContain("1 position(s)");
    expect(notes[0].message).toContain("1 pending order(s) were cancelled");
    expect(await prisma.notification.count({ where: { userId: relaxed.user.id } })).toBe(0);

    // Idempotent: later timer ticks in the same weekend do nothing more.
    for (let i = 0; i < 3; i += 1) {
      tickAll();
      engine.runSecondTick();
    }
    await engine.idle();
    expect(await prisma.notification.count({ where: { userId: strict.user.id } })).toBe(1);

    // Refused (and recorded) until the Sunday open; crypto and relaxed accounts still trade.
    setClock(at("2026-09-26T15:00:00Z")); // Saturday
    const refused = await order(strict.user, strict.acct.id, "w-sat-fx", FX);
    expect(refused).toMatchObject({ status: "REJECTED", reason: "WEEKEND_CLOSED" });
    expect((await prisma.order.findUniqueOrThrow({ where: { accountId_clientOrderId: { accountId: strict.acct.id, clientOrderId: "w-sat-fx" } } })).rejectReason).toMatch(/^WEEKEND_CLOSED: until 2026-09-27T21:00:00.000Z/);
    expect((await order(strict.user, strict.acct.id, "w-sat-crypto", CRYPTO)).status).toBe("FILLED");
    expect((await order(relaxed.user, relaxed.acct.id, "w-sat-relaxed", FX)).status).toBe("FILLED");

    setClock(at("2026-09-27T20:59:59Z"));
    expect((await order(strict.user, strict.acct.id, "w-sun-early", FX)).reason).toBe("WEEKEND_CLOSED");
    setClock(at("2026-09-27T21:00:00Z")); // Sunday 17:00 EDT
    expect((await order(strict.user, strict.acct.id, "w-sun-open", FX)).status).toBe("FILLED");
  });
});

describe("overnight holding rule", () => {
  it("flattens non-crypto positions at 16:55 New York, holds pending orders and refuses new ones until the 17:00 rollover", async () => {
    setClock(at("2026-09-23T20:50:00Z")); // Wednesday 16:50 EDT
    const strict = await account({ overnightHoldingAllowed: false, weekendHoldingAllowed: true });
    const fxPos = await order(strict.user, strict.acct.id, "o-fx", FX);
    const cryptoPos = await order(strict.user, strict.acct.id, "o-crypto", CRYPTO);
    const limit = await order(strict.user, strict.acct.id, "o-limit", FX, { orderType: "LIMIT", price: 1.095 });
    expect(limit.status).toBe("PENDING");

    setClock(at("2026-09-23T20:55:00Z"));
    engine.runSecondTick();
    await engine.idle();
    const closed = await prisma.position.findUniqueOrThrow({ where: { id: fxPos.positionId! } });
    expect(closed.closeReason).toBe("OVERNIGHT");
    expect((await prisma.position.findUniqueOrThrow({ where: { id: cryptoPos.positionId! } })).status).toBe("OPEN");
    // Overnight does not cancel pending orders; it holds them inside the window.
    expect((await prisma.order.findUniqueOrThrow({ where: { id: limit.orderId! } })).status).toBe("PENDING");
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: strict.user.id } });
    expect(note.title).toBe("Positions closed before the daily rollover");

    setClock(at("2026-09-23T20:56:00Z"), { [FX]: [1.094, 1.0941] }); // would fill the limit
    await engine.idle();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: limit.orderId! } })).status).toBe("PENDING");
    expect((await order(strict.user, strict.acct.id, "o-window", FX)).reason).toBe("OVERNIGHT_CLOSED");

    setClock(at("2026-09-23T21:00:00Z"), { [FX]: [1.094, 1.0941] });
    await engine.idle();
    const filled = await prisma.order.findUniqueOrThrow({ where: { id: limit.orderId! } });
    expect(filled.status).toBe("FILLED");
    expect((await order(strict.user, strict.acct.id, "o-after", FX)).status).toBe("FILLED");
  });
});

describe("news-trading rule", () => {
  it("refuses new orders and holds pending orders on affected instruments during [event - W, event + W], while stop-losses still execute", async () => {
    const T = at("2026-09-22T12:30:00Z"); // Tuesday 15:30 EAT
    clock = T - 10 * 60_000;
    const events = await prisma.$transaction([
      prisma.economicEvent.create({ data: { title: "Vitest rate decision", currency: NEWS_CCY, impact: "HIGH", scheduledAt: new Date(T), source: "TEST" } }),
      prisma.economicEvent.create({ data: { title: "Vitest minor data", currency: NEWS_CCY, impact: "LOW", scheduledAt: new Date(T + 30 * 60_000), source: "TEST" } }),
    ]);
    eventIds.push(...events.map((e) => e.id));
    await engine.reloadNewsEvents();
    setClock(T - 10 * 60_000);
    expect(engine.marketStatus().news?.windowMinutes).toBe(2);
    expect(engine.marketStatus().news?.events.map((e) => e.id)).toContain(events[0].id);
    expect(engine.marketStatus().news?.events.map((e) => e.id)).not.toContain(events[1].id);

    const strict = await account({ newsTradingAllowed: false });
    const relaxed = await account({ newsTradingAllowed: true });
    // Before the window: allowed. A long with a stop and a pending buy limit.
    setClock(T - 2 * 60_000 - 1);
    const pos = await order(strict.user, strict.acct.id, "n-pre", NEWSY, { stopLoss: 1.99 });
    expect(pos.status).toBe("FILLED");
    const limit = await order(strict.user, strict.acct.id, "n-limit", NEWSY, { orderType: "LIMIT", price: 1.995 });
    expect(limit.status).toBe("PENDING");

    // Window opens at T - 2 min (inclusive).
    setClock(T - 2 * 60_000);
    const refused = await order(strict.user, strict.acct.id, "n-in", NEWSY);
    expect(refused).toMatchObject({ status: "REJECTED", reason: "NEWS_WINDOW" });
    expect((await order(strict.user, strict.acct.id, "n-other", FX)).status).toBe("FILLED"); // EURUSD is not affected
    expect((await order(relaxed.user, relaxed.acct.id, "n-relaxed", NEWSY)).status).toBe("FILLED");

    // Price spikes through the limit and the stop: the stop executes, the limit waits.
    setClock(T, { [NEWSY]: [1.98, 1.9802] });
    await engine.idle();
    const stopped = await prisma.position.findUniqueOrThrow({ where: { id: pos.positionId! } });
    expect(stopped.status).toBe("CLOSED");
    expect(stopped.closeReason).toBe("STOP_LOSS");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: limit.orderId! } })).status).toBe("PENDING");

    // Still inside at T + 2 min (inclusive), free right after.
    setClock(T + 2 * 60_000, { [NEWSY]: [1.98, 1.9802] });
    await engine.idle();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: limit.orderId! } })).status).toBe("PENDING");
    setClock(T + 2 * 60_000 + 1, { [NEWSY]: [1.98, 1.9802] });
    await engine.idle();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: limit.orderId! } })).status).toBe("FILLED");
    expect((await order(strict.user, strict.acct.id, "n-post", NEWSY)).status).toBe("FILLED");
  });
});
