import type { Instrument, Order, Position, TradeSide } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { roundCurrency } from "@/lib/services/calculations";
import { evaluateAccount, failAccountForBreach } from "@/lib/services/challengeEngine";
import { dailyLossFloor, maxDrawdownFloor } from "@/lib/services/challengeRules";
import { currentDayStart, needsDailyReset, nextDayStart, parseResetTime, type ResetTime } from "@/lib/services/dailyReset";
import { countTradingDays } from "@/lib/services/accountMetrics";
import { alertOps, notifyUser } from "@/lib/services/notifications";
import { interpolate } from "@/i18n/format";
import { dictionaries, type MessageKey } from "@/i18n/messages";
import { isLocale } from "@/i18n/config";
import {
  captureDailyAnchor,
  loadEnabledInstruments,
  loadEngineAccount,
  loadEngineAccounts,
  openPosition,
  persistMarks,
  recordEquitySnapshot,
  recordPositionClose,
  recordRejectedOrder,
  updatePositionRisk,
} from "@/lib/services/tradeLedger";
import type { TemplateSnapshot } from "@/types";
import { FEED_STALE_MS, type AccountState, type ClientMessage, type MarketNews, type OrderKind, type PositionInfo, type ServerMessage, type Side, type Tick } from "@/trading/protocol";
import type { MarketStatusEvent, TradingBus } from "./bus";
import { Converter, NoFxPathError } from "./fx";
import { DEFAULT_NEWS_WINDOW_MINUTES, NEWS_WINDOW_SETTING, activeNewsWindow, normalizeNewsWindowMinutes, type NewsEvent } from "./news";
import { dailyRollover, dailyRolloverCutoff, isRolloverWindow, isWeekendRestricted, weekendCutoff, weekendReopen } from "./sessions";
import {
  applyMarkup,
  checkStops,
  fillPrice,
  grossPnlQuote,
  markPrice,
  pendingFillPrice,
  pendingTriggered,
  requiredMargin,
  roundPrice,
  roundVolume,
  stopExitPrice,
  validatePendingPrice,
  validateStops,
  validateVolume,
  type Quote,
  type RejectCode,
} from "./math";

/**
 * The live execution + risk engine. All state lives in memory and is
 * refreshed from the DB (instruments every 60 s, accounts reconciled every
 * 5 s / reloaded every 30 s). Every write goes through tradeLedger.ts, and
 * all writes for one account are serialised through a per-account queue so
 * a stop-loss close can never race a manual close or a fill.
 *
 * Money: floating P&L is recomputed from the entry price on every tick
 * (never accumulated), converted to the account currency (ETB) via fx.ts and
 * rounded with roundCurrency at every persistence boundary.
 *
 * Challenge holding rules (per account snapshot): no weekend holding
 * flattens FX/metal/index positions at Friday 16:45 New York and refuses new
 * ones until the Sunday open; no overnight holding flattens them at 16:55 New
 * York each weekday; no news trading refuses new exposure (and holds pending
 * orders) around HIGH-impact events in the instrument's currencies. Crypto is
 * exempt from the session rules. Closing and SL/TP are never blocked.
 */

export type EngineLogger = {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
  error: (o: unknown, m?: string) => void;
  debug: (o: unknown, m?: string) => void;
};

type EngineQuote = Quote & { raw: Quote; ts: number; receivedAt: number; source: string };

export type EnginePosition = {
  id: string;
  accountId: string;
  symbol: string;
  side: Side;
  volume: number;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  marginUsed: number;
  openedAt: Date;
  currentPrice: number | null;
  floatingPnl: number;
  feedSource: string | null;
  closing: boolean;
  dirty: boolean;
};

type EnginePending = {
  id: string;
  accountId: string;
  symbol: string;
  side: Side;
  type: Extract<OrderKind, "LIMIT" | "STOP">;
  volume: number;
  price: number;
  stopLoss: number | null;
  takeProfit: number | null;
  clientOrderId: string;
  triggering: boolean;
};

export type EngineAccount = {
  id: string;
  userId: string;
  status: string;
  phase: string;
  snapshot: TemplateSnapshot;
  startingBalance: number;
  balance: number;
  highWaterMark: number;
  dailyAnchorBalance: number;
  dailyAnchorDate: Date;
  realizedPnl: number;
  marginUsed: number;
  expiresAt: Date | null;
  positions: Map<string, EnginePosition>;
  pending: Map<string, EnginePending>;
  equity: number;
  floating: number;
  dirty: boolean;
  breaching: boolean;
  untracked: boolean;
  tradingDays: number;
  resetTime: ResetTime;
  nextBoundary: Date;
  lastSnapshotEquity: number;
  lastSnapshotAt: number;
  emitTimer: NodeJS.Timeout | null;
  /** Cutoff (epoch ms) each holding rule last flattened this account for: at most one sweep per cutoff. */
  ruleSweeps: Partial<Record<HoldingRule, number>>;
  /** After a failed rule sweep, when to try again. */
  ruleRetryAt: number;
};

type HoldingRule = "WEEKEND" | "OVERNIGHT";
type CloseReason = "MANUAL" | "STOP_LOSS" | "TAKE_PROFIT" | "BREACH" | "ADMIN" | "WEEKEND" | "OVERNIGHT" | "NEWS";

type Ctx = { userId: string; role: string };

type LoadedAccount = NonNullable<Awaited<ReturnType<typeof loadEngineAccount>>>;

const TRADABLE = new Set(["ACTIVE", "FUNDED"]);
const ACCOUNT_EMIT_MS = 250;
const FLUSH_MS = 2_000;
const SNAPSHOT_MIN_MOVE = 0.001;
const SNAPSHOT_MAX_AGE_MS = 30_000;
const RECONCILE_MS = 5_000;
const RELOAD_MS = 30_000;
const INSTRUMENTS_MS = 60_000;
const LAG_SAMPLES = 256;
const NEWS_MS = 60_000;
/** Events kept in memory: from 2 h ago (covers any window) to a week ahead. */
const NEWS_LOOKBACK_MS = 2 * 3_600_000;
const NEWS_LOOKAHEAD_MS = 7 * 86_400_000;
/** Events pushed to terminals on market.status. */
const NEWS_PUSH_HORIZON_MS = 24 * 3_600_000;
const RULE_RETRY_MS = 60_000;

export class RejectError extends Error {
  constructor(
    public code: RejectCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export type EngineOptions = {
  bus: TradingBus;
  fx: Converter;
  log: EngineLogger;
  now?: () => number;
  /** Test hook: skip loading every ACTIVE/FUNDED account at start (use reloadAccount instead). */
  loadAccountsOnStart?: boolean;
};

export class Engine {
  readonly instruments = new Map<string, Instrument>();
  readonly accounts = new Map<string, EngineAccount>();
  private positionsBySymbol = new Map<string, Set<EnginePosition>>();
  private pendingBySymbol = new Map<string, Set<EnginePending>>();
  private quotes = new Map<string, EngineQuote>();
  private queues = new Map<string, Promise<void>>();
  private inflight = 0;
  private idleWaiters: (() => void)[] = [];
  private lastTickAt: number | null = null;
  private manualHalt = false;
  private manualHaltReason: string | undefined;
  private marketState: MarketStatusEvent = { state: "HALTED", reason: "no feed yet", symbols: {} };
  private staleSymbols = new Set<string>();
  private timers: NodeJS.Timeout[] = [];
  private lag: number[] = [];
  private lastSweep: unknown = null;
  private started = false;
  private newsEvents: NewsEvent[] = [];
  private newsWindowMs = DEFAULT_NEWS_WINDOW_MINUTES * 60_000;
  private newsKey = "";
  private readonly now: () => number;
  private readonly bus: TradingBus;
  private readonly fx: Converter;
  private readonly log: EngineLogger;

  constructor(private readonly opts: EngineOptions) {
    this.bus = opts.bus;
    this.fx = opts.fx;
    this.log = opts.log;
    this.now = opts.now ?? (() => Date.now());
  }

  // ---------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------

  async start(): Promise<void> {
    await this.reloadInstruments();
    this.manualHalt = await readKillSwitch();
    if (this.manualHalt) this.manualHaltReason = "manual kill switch (SystemSetting trading.halted)";
    await this.reloadNewsEvents().catch((err) => this.log.error({ err: msg(err) }, "engine: news calendar load failed"));
    if (this.opts.loadAccountsOnStart !== false) {
      const rows = await loadEngineAccounts();
      for (const row of rows) await this.trackFromRow(row);
      this.log.info({ accounts: this.accounts.size, instruments: this.instruments.size }, "engine: state loaded");
    }
    this.started = true;
    this.updateMarketState(true);
  }

  startTimers(): void {
    this.timers.push(setInterval(() => this.secondTick(), 1_000));
    this.timers.push(setInterval(() => void this.flush().catch((err) => this.log.error({ err: msg(err) }, "engine: flush failed")), FLUSH_MS));
    this.timers.push(setInterval(() => void this.reconcile().catch((err) => this.log.error({ err: msg(err) }, "engine: reconcile failed")), RECONCILE_MS));
    this.timers.push(setInterval(() => void this.reloadAllAccounts().catch((err) => this.log.error({ err: msg(err) }, "engine: reload failed")), RELOAD_MS));
    this.timers.push(setInterval(() => void this.reloadInstruments().catch((err) => this.log.error({ err: msg(err) }, "engine: instrument reload failed")), INSTRUMENTS_MS));
    this.timers.push(setInterval(() => void this.reloadNewsEvents().catch((err) => this.log.error({ err: msg(err) }, "engine: news calendar reload failed")), NEWS_MS));
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const a of this.accounts.values()) if (a.emitTimer) clearTimeout(a.emitTimer);
    await this.idle();
    await this.flush().catch((err) => this.log.error({ err: msg(err) }, "engine: final flush failed"));
  }

  /** Resolves once every queued account operation has finished (tests, shutdown). */
  idle(): Promise<void> {
    if (this.inflight === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  // ---------------------------------------------------------------------
  // loading / tracking
  // ---------------------------------------------------------------------

  async reloadInstruments(): Promise<void> {
    const rows = await loadEnabledInstruments();
    const seen = new Set<string>();
    for (const r of rows) {
      this.instruments.set(r.symbol, r);
      seen.add(r.symbol);
    }
    for (const s of Array.from(this.instruments.keys())) if (!seen.has(s)) this.instruments.delete(s);
  }

  /** Reloads upcoming HIGH-impact events and the ± window (SystemSetting rules.newsWindowMinutes). */
  async reloadNewsEvents(): Promise<void> {
    const now = this.now();
    const [rows, setting] = await Promise.all([
      prisma.economicEvent.findMany({
        where: { impact: "HIGH", scheduledAt: { gte: new Date(now - NEWS_LOOKBACK_MS), lte: new Date(now + NEWS_LOOKAHEAD_MS) } },
        orderBy: { scheduledAt: "asc" },
        take: 1_000,
        select: { id: true, title: true, currency: true, scheduledAt: true },
      }),
      prisma.systemSetting.findUnique({ where: { key: NEWS_WINDOW_SETTING } }),
    ]);
    this.newsEvents = rows.map((r) => ({ id: r.id, title: r.title, currency: r.currency.toUpperCase(), scheduledAt: r.scheduledAt.getTime() }));
    this.newsWindowMs = normalizeNewsWindowMinutes(setting?.value) * 60_000;
    if (this.started) this.updateMarketState();
  }

  /** Loads (or refreshes) one account from the DB; returns null if it is not tradable. */
  async reloadAccount(accountId: string): Promise<EngineAccount | null> {
    const row = await loadEngineAccount(accountId);
    if (!row) {
      this.untrack(accountId, "deleted");
      return null;
    }
    return this.trackFromRow(row);
  }

  private async trackFromRow(row: LoadedAccount): Promise<EngineAccount | null> {
    if (!TRADABLE.has(row.status)) {
      if (this.accounts.has(row.id)) await this.closeAllAndUntrack(this.accounts.get(row.id)!, "ADMIN", `status ${row.status}`);
      return null;
    }
    const existing = this.accounts.get(row.id);
    if (existing) {
      this.mergeRow(existing, row);
      return existing;
    }
    const snapshot = row.snapshot as unknown as TemplateSnapshot;
    const resetTime = parseResetTime(snapshot.dailyLossResetTime);
    const now = new Date(this.now());
    const acct: EngineAccount = {
      id: row.id,
      userId: row.userId,
      status: row.status,
      phase: row.phase,
      snapshot,
      startingBalance: row.startingBalance,
      balance: row.balance,
      highWaterMark: row.highWaterMark,
      dailyAnchorBalance: row.dailyAnchorBalance,
      dailyAnchorDate: row.dailyAnchorDate,
      realizedPnl: row.realizedPnl,
      marginUsed: row.marginUsed,
      expiresAt: row.expiresAt,
      positions: new Map(),
      pending: new Map(),
      equity: row.equity,
      floating: 0,
      dirty: false,
      breaching: false,
      untracked: false,
      tradingDays: 0,
      resetTime,
      nextBoundary: nextDayStart(resetTime, now),
      lastSnapshotEquity: row.equity,
      lastSnapshotAt: this.now(),
      emitTimer: null,
      ruleSweeps: {},
      ruleRetryAt: 0,
    };
    for (const p of row.positions) this.addPosition(acct, p);
    const pendingRows = await prisma.order.findMany({ where: { accountId: row.id, status: "PENDING", type: { in: ["LIMIT", "STOP"] } } });
    for (const o of pendingRows) this.addPending(acct, o);
    this.accounts.set(acct.id, acct);

    // A reset boundary passed while nobody was watching this account: let the
    // rules engine re-anchor it (it reconstructs the equity at the boundary)
    // so the live engine and the DB rules agree on today's floor.
    if (needsDailyReset(acct.dailyAnchorDate, resetTime, now)) {
      try {
        const fresh = await evaluateAccount(acct.id, undefined, { now });
        this.applyAccountRow(acct, fresh);
        if (!TRADABLE.has(fresh.status)) {
          this.untrack(acct.id, `status ${fresh.status} at load`);
          return null;
        }
      } catch (err) {
        this.log.error({ err: msg(err), accountId: acct.id }, "engine: re-anchoring at load failed; using the current equity");
        const boundary = currentDayStart(resetTime, now);
        this.recompute(acct);
        await captureDailyAnchor(acct.id, acct.equity, boundary);
        acct.dailyAnchorBalance = acct.equity;
        acct.dailyAnchorDate = boundary;
      }
    }
    void this.refreshTradingDays(acct);
    this.recompute(acct);
    this.emitAccount(acct, true);
    return acct;
  }

  private mergeRow(acct: EngineAccount, row: LoadedAccount) {
    acct.status = row.status;
    acct.balance = row.balance;
    acct.realizedPnl = row.realizedPnl;
    acct.highWaterMark = Math.max(acct.highWaterMark, row.highWaterMark);
    acct.dailyAnchorBalance = row.dailyAnchorBalance;
    acct.dailyAnchorDate = row.dailyAnchorDate;
    acct.expiresAt = row.expiresAt;
    acct.snapshot = row.snapshot as unknown as TemplateSnapshot;
    const dbIds = new Set(row.positions.map((p) => p.id));
    for (const p of row.positions) if (!acct.positions.has(p.id)) this.addPosition(acct, p);
    for (const p of Array.from(acct.positions.values())) if (!dbIds.has(p.id) && !p.closing) this.removePosition(acct, p);
    this.recompute(acct);
  }

  private addPosition(acct: EngineAccount, p: Position): EnginePosition {
    const pos: EnginePosition = {
      id: p.id,
      accountId: p.accountId,
      symbol: p.symbol,
      side: p.side,
      volume: p.volume,
      entryPrice: p.entryPrice,
      stopLoss: p.stopLoss,
      takeProfit: p.takeProfit,
      marginUsed: p.marginUsed,
      openedAt: p.openedAt,
      currentPrice: p.currentPrice,
      floatingPnl: p.floatingPnl,
      feedSource: p.feedSource,
      closing: false,
      dirty: false,
    };
    acct.positions.set(pos.id, pos);
    let set = this.positionsBySymbol.get(pos.symbol);
    if (!set) {
      set = new Set();
      this.positionsBySymbol.set(pos.symbol, set);
    }
    set.add(pos);
    const q = this.quotes.get(pos.symbol);
    if (q) this.markPosition(pos, q);
    return pos;
  }

  private removePosition(acct: EngineAccount, pos: EnginePosition) {
    acct.positions.delete(pos.id);
    this.positionsBySymbol.get(pos.symbol)?.delete(pos);
  }

  private addPending(acct: EngineAccount, o: Order) {
    if (o.type === "MARKET" || o.price == null) return;
    const pending: EnginePending = {
      id: o.id,
      accountId: o.accountId,
      symbol: o.symbol,
      side: o.side,
      type: o.type,
      volume: o.volume,
      price: o.price,
      stopLoss: o.stopLoss,
      takeProfit: o.takeProfit,
      clientOrderId: o.clientOrderId,
      triggering: false,
    };
    acct.pending.set(pending.id, pending);
    let set = this.pendingBySymbol.get(pending.symbol);
    if (!set) {
      set = new Set();
      this.pendingBySymbol.set(pending.symbol, set);
    }
    set.add(pending);
  }

  private removePending(acct: EngineAccount, pending: EnginePending) {
    acct.pending.delete(pending.id);
    this.pendingBySymbol.get(pending.symbol)?.delete(pending);
  }

  private untrack(accountId: string, why: string) {
    const acct = this.accounts.get(accountId);
    if (!acct) return;
    for (const p of Array.from(acct.positions.values())) this.removePosition(acct, p);
    for (const o of Array.from(acct.pending.values())) this.removePending(acct, o);
    if (acct.emitTimer) clearTimeout(acct.emitTimer);
    acct.untracked = true;
    this.accounts.delete(accountId);
    this.log.info({ accountId, why }, "engine: account untracked");
  }

  private async refreshTradingDays(acct: EngineAccount) {
    try {
      acct.tradingDays = await countTradingDays(acct.id, acct.resetTime);
    } catch (err) {
      this.log.debug({ err: msg(err) }, "engine: tradingDays unavailable");
    }
  }

  // ---------------------------------------------------------------------
  // per-account serial queue
  // ---------------------------------------------------------------------

  private enqueue<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(accountId) ?? Promise.resolve();
    this.inflight += 1;
    const run = prev.then(fn, fn);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(accountId, settled);
    void settled.then(() => {
      this.inflight -= 1;
      if (this.queues.get(accountId) === settled) this.queues.delete(accountId);
      if (this.inflight === 0) {
        const waiters = this.idleWaiters;
        this.idleWaiters = [];
        for (const w of waiters) w();
      }
    });
    return run;
  }

  // ---------------------------------------------------------------------
  // ticks
  // ---------------------------------------------------------------------

  onTick(tick: Tick): void {
    const receivedAt = this.now();
    const inst = this.instruments.get(tick.symbol);
    if (!inst) return;
    const eff = applyMarkup(tick, inst.spreadMarkupPoints, inst.digits);
    const quote: EngineQuote = { bid: eff.bid, ask: eff.ask, raw: { bid: tick.bid, ask: tick.ask }, ts: tick.ts, receivedAt, source: tick.source };
    this.quotes.set(tick.symbol, quote);
    this.lastTickAt = receivedAt;
    this.fx.updateMid(tick.symbol, (tick.bid + tick.ask) / 2);
    if (this.marketState.state === "HALTED" || this.staleSymbols.has(tick.symbol)) this.updateMarketState();
    const open = this.marketState.state === "OPEN";

    const touched = new Set<EngineAccount>();
    const positions = this.positionsBySymbol.get(tick.symbol);
    if (positions) {
      for (const pos of positions) {
        const acct = this.accounts.get(pos.accountId);
        if (!acct) continue;
        this.markPosition(pos, quote);
        touched.add(acct);
        if (open && !pos.closing && !acct.breaching) {
          const trigger = checkStops(pos.side, quote, pos.stopLoss, pos.takeProfit);
          if (trigger) {
            pos.closing = true;
            const price = stopExitPrice(trigger, pos.stopLoss, pos.takeProfit);
            void this.enqueue(acct.id, () => this.closePositionInternal(acct, pos, price, trigger, undefined, null, quote)).catch((err) =>
              this.log.error({ err: msg(err), positionId: pos.id }, "engine: stop close failed"),
            );
          }
        }
      }
    }

    const pendings = this.pendingBySymbol.get(tick.symbol);
    if (pendings && open) {
      for (const order of pendings) {
        const acct = this.accounts.get(order.accountId);
        if (!acct || order.triggering || acct.breaching) continue;
        if (pendingTriggered(order.side, order.type, order.price, quote)) {
          // A rule window (news, weekend, rollover) keeps the order pending instead of opening exposure.
          const inst = this.instruments.get(order.symbol);
          if (inst && this.ruleRestriction(acct, inst, receivedAt)) continue;
          order.triggering = true;
          void this.enqueue(acct.id, () => this.triggerPending(acct, order, quote)).catch((err) =>
            this.log.error({ err: msg(err), orderId: order.id }, "engine: pending trigger failed"),
          );
        }
      }
    }

    for (const acct of touched) {
      this.recompute(acct);
      if (open && !acct.breaching && !this.holdsStaleSymbol(acct)) this.checkBreach(acct);
      this.emitAccount(acct);
    }

    const lag = this.now() - receivedAt;
    this.lag.push(lag);
    if (this.lag.length > LAG_SAMPLES) this.lag.shift();
  }

  private markPosition(pos: EnginePosition, q: EngineQuote) {
    const inst = this.instruments.get(pos.symbol);
    if (!inst) return;
    const mark = markPrice(pos.side, q);
    const rate = this.fx.rate(inst.quoteCurrency);
    if (rate == null) return; // keep the last known floating until an FX path exists
    pos.currentPrice = mark;
    pos.floatingPnl = roundCurrency(grossPnlQuote(pos.side, pos.entryPrice, mark, pos.volume, inst.contractSize) * rate);
    pos.dirty = true;
  }

  private recompute(acct: EngineAccount) {
    let floating = 0;
    let margin = 0;
    for (const p of acct.positions.values()) {
      floating += p.floatingPnl;
      margin += p.marginUsed;
    }
    acct.floating = roundCurrency(floating);
    acct.marginUsed = roundCurrency(margin);
    acct.equity = roundCurrency(acct.balance + acct.floating);
    if (acct.equity > acct.highWaterMark) acct.highWaterMark = acct.equity;
    acct.dirty = true;
  }

  private holdsStaleSymbol(acct: EngineAccount): boolean {
    for (const p of acct.positions.values()) if (this.staleSymbols.has(p.symbol)) return true;
    return false;
  }

  floors(acct: EngineAccount): { ddFloor: number; dlFloor: number } {
    return {
      ddFloor: maxDrawdownFloor({
        startingBalance: acct.startingBalance,
        highWaterMark: acct.highWaterMark,
        maxDrawdownPercent: acct.snapshot.maxDrawdown,
        mode: acct.snapshot.drawdownMode ?? "STATIC",
      }),
      dlFloor: dailyLossFloor({ dailyAnchorBalance: acct.dailyAnchorBalance, dailyDrawdownPercent: acct.snapshot.dailyDrawdown }),
    };
  }

  private checkBreach(acct: EngineAccount) {
    const { ddFloor, dlFloor } = this.floors(acct);
    const equity = roundCurrency(acct.equity);
    let reason: "MAX_DRAWDOWN" | "DAILY_LOSS" | null = null;
    let floor = 0;
    if (equity <= ddFloor) {
      reason = "MAX_DRAWDOWN";
      floor = ddFloor;
    } else if (equity <= dlFloor) {
      reason = "DAILY_LOSS";
      floor = dlFloor;
    }
    if (!reason) return;
    acct.breaching = true;
    this.log.warn({ accountId: acct.id, equity, floor, reason }, "engine: BREACH detected");
    void this.enqueue(acct.id, () => this.executeBreach(acct, reason!, equity, floor)).catch((err) =>
      this.log.error({ err: msg(err), accountId: acct.id }, "engine: breach handling failed"),
    );
  }

  private async executeBreach(acct: EngineAccount, reason: "MAX_DRAWDOWN" | "DAILY_LOSS", equity: number, floor: number) {
    await this.flushAccount(acct);
    let closeErrors = 0;
    for (const pos of Array.from(acct.positions.values())) {
      const q = this.quotes.get(pos.symbol);
      if (!q) {
        closeErrors += 1;
        this.log.error({ positionId: pos.id }, "engine: no quote to close position on breach");
        continue;
      }
      pos.closing = true;
      try {
        await this.closePositionInternal(acct, pos, markPrice(pos.side, q), "BREACH", undefined, null, q, true);
      } catch (err) {
        closeErrors += 1;
        pos.closing = false;
        this.log.error({ err: msg(err), positionId: pos.id }, "engine: breach close failed");
      }
    }
    try {
      const after = await failAccountForBreach(acct.id, reason, { equity, floor });
      acct.status = after.status;
      acct.balance = after.balance;
      acct.realizedPnl = after.realizedPnl;
    } catch (err) {
      this.log.error({ err: msg(err), accountId: acct.id }, "engine: failAccountForBreach failed");
    }
    await this.cancelPendingOrders(acct, `ACCOUNT_${reason}`);
    this.recompute(acct);
    this.emitAccount(acct, true);
    this.untrack(acct.id, `breach ${reason}`);
    void alertOps(`MellaFx: account ${acct.id} FAILED (${reason}). equity ${equity.toFixed(2)} <= floor ${floor.toFixed(2)}${closeErrors ? `; ${closeErrors} position close error(s) - check manually` : ""}`);
  }

  // ---------------------------------------------------------------------
  // market state / halts
  // ---------------------------------------------------------------------

  private secondTick() {
    this.updateMarketState();
    const now = this.now();
    for (const acct of this.accounts.values()) {
      if (now >= acct.nextBoundary.getTime() && !acct.breaching) {
        const boundary = currentDayStart(acct.resetTime, new Date(now));
        acct.nextBoundary = nextDayStart(acct.resetTime, new Date(now));
        void this.enqueue(acct.id, async () => {
          if (acct.untracked) return;
          this.recompute(acct);
          await captureDailyAnchor(acct.id, acct.equity, boundary);
          acct.dailyAnchorBalance = acct.equity;
          acct.dailyAnchorDate = boundary;
          this.log.info({ accountId: acct.id, anchor: acct.equity, boundary }, "engine: daily anchor captured");
          this.emitAccount(acct, true);
        }).catch((err) => this.log.error({ err: msg(err), accountId: acct.id }, "engine: daily anchor failed"));
      }
    }
    this.enforceHoldingRules(now);
  }

  /** The 1 s timer body: market state, daily anchors, holding rules (tests call it with a fake clock). */
  runSecondTick(): void {
    this.secondTick();
  }

  // ---------------------------------------------------------------------
  // challenge holding / news rules
  // ---------------------------------------------------------------------

  /**
   * Why this account may not open new exposure on `inst` right now, or null.
   * Applies to new orders and to triggering pending orders; never to closes.
   */
  private ruleRestriction(acct: EngineAccount, inst: Instrument, now: number): { code: RejectCode; detail: string } | null {
    const rules = acct.snapshot;
    if (inst.category !== "CRYPTO") {
      if (rules.weekendHoldingAllowed === false && isWeekendRestricted(now)) return { code: "WEEKEND_CLOSED", detail: `until ${weekendReopen(now).toISOString()}` };
      if (rules.overnightHoldingAllowed === false && isRolloverWindow(now)) return { code: "OVERNIGHT_CLOSED", detail: `until ${dailyRollover(now).toISOString()}` };
    }
    if (rules.newsTradingAllowed === false) {
      const w = activeNewsWindow(this.newsEvents, inst, now, this.newsWindowMs);
      if (w) return { code: "NEWS_WINDOW", detail: `${w.event.currency} ${w.event.title} until ${new Date(w.end).toISOString()}` };
    }
    return null;
  }

  /**
   * Schedules at most one flattening per account per cutoff while a holding
   * window is open (Friday 16:45 .. Sunday 17:00 for weekend, 16:55 .. 17:00
   * for overnight). The work itself runs on the account queue.
   */
  private enforceHoldingRules(now: number) {
    const weekend = isWeekendRestricted(now);
    const rollover = isRolloverWindow(now);
    if (!weekend && !rollover) return;
    const weekendKey = weekend ? weekendCutoff(now).getTime() : 0;
    const rolloverKey = rollover ? dailyRolloverCutoff(now).getTime() : 0;
    for (const acct of this.accounts.values()) {
      if (acct.breaching || acct.untracked || now < acct.ruleRetryAt) continue;
      let rule: HoldingRule | null = null;
      let key = 0;
      if (weekend && acct.snapshot.weekendHoldingAllowed === false) {
        rule = "WEEKEND";
        key = weekendKey;
      } else if (rollover && acct.snapshot.overnightHoldingAllowed === false) {
        rule = "OVERNIGHT";
        key = rolloverKey;
      }
      if (!rule || acct.ruleSweeps[rule] === key) continue;
      acct.ruleSweeps[rule] = key;
      const which = rule;
      void this.enqueue(acct.id, () => this.flattenForRule(acct, which)).catch((err) =>
        this.log.error({ err: msg(err), accountId: acct.id, rule: which }, "engine: holding-rule sweep failed"),
      );
    }
  }

  /** Closes the account's non-crypto positions (and, for the weekend, cancels its non-crypto pending orders). */
  private async flattenForRule(acct: EngineAccount, rule: HoldingRule) {
    if (acct.untracked || acct.breaching) return;
    const closed: { symbol: string; netProfit: number | null }[] = [];
    let failures = 0;
    for (const pos of Array.from(acct.positions.values())) {
      if (acct.untracked) break; // a close passed/failed the account
      const inst = this.instruments.get(pos.symbol);
      if (!inst || inst.category === "CRYPTO" || pos.closing) continue;
      // Live price when there is one; otherwise the last persisted mark (e.g. a restart after the feed closed for the weekend).
      const q = this.quotes.get(pos.symbol);
      const price = q ? markPrice(pos.side, q) : pos.currentPrice;
      if (price == null) {
        failures += 1;
        this.log.error({ positionId: pos.id, rule }, "engine: no price to close position for holding rule");
        continue;
      }
      pos.closing = true;
      try {
        const netProfit = await this.closePositionInternal(acct, pos, price, rule, undefined, null, q);
        closed.push({ symbol: pos.symbol, netProfit });
      } catch (err) {
        failures += 1;
        pos.closing = false;
        this.log.error({ err: msg(err), positionId: pos.id, rule }, "engine: holding-rule close failed");
      }
    }
    let cancelled = 0;
    if (rule === "WEEKEND" && !acct.untracked) {
      cancelled = await this.cancelPendingOrders(acct, "WEEKEND_CLOSED", (o) => this.instruments.get(o.symbol)?.category !== "CRYPTO");
    }
    if (failures > 0) {
      // Allow another attempt for this cutoff shortly.
      delete acct.ruleSweeps[rule];
      acct.ruleRetryAt = this.now() + RULE_RETRY_MS;
      void alertOps(`MellaFx: ${rule.toLowerCase()} rule could not close ${failures} position(s) on account ${acct.id} - retrying in ${RULE_RETRY_MS / 1000}s`);
    }
    if (closed.length === 0 && cancelled === 0) return;
    this.log.info({ accountId: acct.id, rule, closed: closed.length, cancelled }, "engine: holding rule applied");
    await notifyRuleApplied(acct, rule, closed.length, cancelled).catch((err) => this.log.error({ err: msg(err), accountId: acct.id }, "engine: rule notification failed"));
  }

  /** Upcoming HIGH-impact events for terminals (the 24 h ahead plus any window still open). */
  private marketNews(now: number): MarketNews {
    const events = this.newsEvents.filter((e) => e.scheduledAt + this.newsWindowMs >= now && e.scheduledAt <= now + NEWS_PUSH_HORIZON_MS);
    return { windowMinutes: this.newsWindowMs / 60_000, events };
  }

  private updateMarketState(force = false) {
    const now = this.now();
    const symbols: MarketStatusEvent["symbols"] = {};
    const stale = new Set<string>();
    for (const symbol of this.instruments.keys()) {
      const q = this.quotes.get(symbol);
      const at = q?.receivedAt ?? null;
      const isStale = at == null || now - at > FEED_STALE_MS;
      symbols[symbol] = { lastTickAt: at, stale: isStale };
      if (isStale) stale.add(symbol);
    }
    const feedStale = this.lastTickAt == null || now - this.lastTickAt > FEED_STALE_MS;
    let state: MarketStatusEvent["state"] = "OPEN";
    let reason: string | undefined;
    if (this.manualHalt) {
      state = "HALTED";
      reason = this.manualHaltReason ?? "manual halt";
    } else if (feedStale) {
      state = "HALTED";
      reason = this.lastTickAt == null ? "no market data received yet" : `no market data for ${Math.round((now - this.lastTickAt) / 1000)}s`;
    }
    const staleChanged = stale.size !== this.staleSymbols.size || Array.from(stale).some((s) => !this.staleSymbols.has(s));
    const news = this.marketNews(now);
    const newsKey = `${news.windowMinutes}|${news.events.map((e) => `${e.id}@${e.scheduledAt}`).join(",")}`;
    const newsChanged = newsKey !== this.newsKey;
    this.newsKey = newsKey;
    const changed = force || state !== this.marketState.state || reason !== this.marketState.reason || staleChanged;
    this.staleSymbols = stale;
    this.marketState = { state, reason, symbols, news };
    if (!changed && newsChanged) {
      this.bus.emit("market.status", this.marketState);
    } else if (changed) {
      if (state !== "OPEN" || force) this.log.warn({ state, reason, stale: Array.from(stale) }, "engine: market status");
      else this.log.info({ state, stale: Array.from(stale) }, "engine: market status");
      this.bus.emit("market.status", this.marketState);
    }
  }

  /** Re-evaluates staleness now (the 1 s timer does this in production; tests call it directly). */
  refreshMarketState(): void {
    this.updateMarketState();
  }

  marketStatus(): MarketStatusEvent {
    return this.marketState;
  }

  async setManualHalt(halted: boolean, reason?: string): Promise<void> {
    this.manualHalt = halted;
    this.manualHaltReason = halted ? (reason ?? "manual halt") : undefined;
    await prisma.systemSetting.upsert({
      where: { key: "trading.halted" },
      create: { key: "trading.halted", value: { halted, reason: reason ?? null, at: new Date().toISOString() } },
      update: { value: { halted, reason: reason ?? null, at: new Date().toISOString() } },
    });
    this.updateMarketState(true);
  }

  isManuallyHalted(): boolean {
    return this.manualHalt;
  }

  // ---------------------------------------------------------------------
  // client messages
  // ---------------------------------------------------------------------

  async handle(ctx: Ctx, message: ClientMessage): Promise<ServerMessage[]> {
    switch (message.type) {
      case "order.place":
        return this.enqueue(message.accountId, () => this.placeOrder(ctx, message));
      case "position.close":
        return this.enqueue(message.accountId, () => this.closePositionRequest(ctx, message));
      case "position.modify":
        return this.enqueue(message.accountId, () => this.modifyPositionRequest(ctx, message));
      case "account.get": {
        const acct = await this.resolveAccount(ctx, message.accountId);
        if (!acct) return [{ type: "error", code: "NOT_FOUND", message: "Account not found or not tradable" }];
        return [{ type: "account", account: this.accountState(acct) }];
      }
      default:
        return [{ type: "error", code: "BAD_REQUEST", message: `Unsupported message type ${(message as { type: string }).type}` }];
    }
  }

  /** Finds a tracked account owned by the caller, loading it if a purchase activated after startup. */
  private async resolveAccount(ctx: Ctx, accountId: string): Promise<EngineAccount | null> {
    let acct = this.accounts.get(accountId) ?? null;
    if (!acct) acct = await this.reloadAccount(accountId);
    if (!acct) return null;
    if (acct.userId !== ctx.userId && ctx.role !== "ADMIN") return null;
    return acct;
  }

  private freshQuote(symbol: string): EngineQuote | null {
    const q = this.quotes.get(symbol);
    if (!q || this.staleSymbols.has(symbol) || this.marketState.state !== "OPEN") return null;
    return q;
  }

  private async placeOrder(ctx: Ctx, m: Extract<ClientMessage, { type: "order.place" }>): Promise<ServerMessage[]> {
    const reply = (r: Omit<Extract<ServerMessage, { type: "order.result" }>, "type" | "clientOrderId">): ServerMessage[] => [
      { type: "order.result", clientOrderId: m.clientOrderId, ...r },
    ];
    const acct = await this.resolveAccount(ctx, m.accountId);
    if (!acct) return reply({ status: "REJECTED", reason: "ACCOUNT_NOT_TRADABLE" });

    const reject = async (code: RejectCode, detail?: string, record = true): Promise<ServerMessage[]> => {
      this.log.info({ accountId: acct.id, clientOrderId: m.clientOrderId, code, detail }, "engine: order rejected");
      if (!record) return reply({ status: "REJECTED", reason: code });
      try {
        await recordRejectedOrder({
          accountId: acct.id,
          symbol: m.symbol,
          side: m.side,
          volume: Number(m.volume) || 0,
          type: m.orderType,
          price: m.price ?? null,
          clientOrderId: m.clientOrderId,
          reason: detail ? `${code}: ${detail}` : code,
        });
      } catch (err) {
        this.log.error({ err: msg(err) }, "engine: recordRejectedOrder failed");
      }
      return reply({ status: "REJECTED", reason: code });
    };

    try {
      if (acct.breaching || !TRADABLE.has(acct.status)) return reject("ACCOUNT_NOT_TRADABLE");
      const inst = this.instruments.get(m.symbol);
      // Order.symbol references Instrument, so an unknown symbol cannot be recorded as a rejected order.
      if (!inst || !inst.enabled) return reject("UNKNOWN_SYMBOL", undefined, false);
      const restriction = this.ruleRestriction(acct, inst, this.now());
      if (restriction) return reject(restriction.code, restriction.detail);
      const q = this.freshQuote(m.symbol);
      if (!q) return reject("MARKET_HALTED", this.marketState.reason ?? `${m.symbol} has no fresh price`);
      // Validate the volume exactly as requested (never round 0.015 up to a valid 0.02), then normalise.
      const volErr = validateVolume(Number(m.volume), inst);
      if (volErr) return reject(volErr, `min ${inst.minVolume} max ${inst.maxVolume} step ${inst.volumeStep}`);
      const volume = roundVolume(Number(m.volume));
      const rules = acct.snapshot;
      if (rules.maxPositions != null && rules.maxPositions > 0 && acct.positions.size + acct.pending.size >= rules.maxPositions) return reject("MAX_POSITIONS", `limit ${rules.maxPositions}`);
      if (rules.maxPositionSize != null && rules.maxPositionSize > 0 && volume > rules.maxPositionSize + 1e-9) return reject("MAX_POSITION_SIZE", `limit ${rules.maxPositionSize} lots`);
      const rate = this.fx.rate(inst.quoteCurrency);
      if (rate == null) return reject("NO_FX_PATH", `${inst.quoteCurrency} -> ${this.fx.accountCurrency}`);

      if (m.orderType === "MARKET") {
        const price = fillPrice(m.side, q);
        const stopErr = validateStops(m.side, price, m.stopLoss, m.takeProfit);
        if (stopErr) return reject(stopErr, `fill price ${price}`);
        const margin = requiredMargin(volume, inst.contractSize, price, rate, rules.leverage);
        const free = roundCurrency(acct.equity - acct.marginUsed);
        if (margin > free) return reject("INSUFFICIENT_MARGIN", `required ${margin} free ${free}`);
        const res = await openPosition({
          accountId: acct.id,
          symbol: inst.symbol,
          side: m.side,
          volume,
          entryPrice: price,
          stopLoss: m.stopLoss ?? null,
          takeProfit: m.takeProfit ?? null,
          marginUsed: margin,
          entryTickTs: new Date(q.ts),
          feedSource: q.source,
          order: { clientOrderId: m.clientOrderId, type: "MARKET" },
        });
        if (res.duplicate) {
          const existing = res.position ? acct.positions.get(res.position.id) : undefined;
          if (!existing && res.position && res.position.status === "OPEN") this.addPosition(acct, res.position);
          this.recompute(acct);
          if (res.order.status === "FILLED") return reply({ status: "FILLED", orderId: res.order.id, positionId: res.order.positionId ?? undefined, filledPrice: res.order.filledPrice ?? undefined });
          return reply({ status: res.order.status === "PENDING" ? "PENDING" : "REJECTED", orderId: res.order.id, reason: res.order.rejectReason ?? undefined });
        }
        const pos = this.addPosition(acct, res.position);
        this.recompute(acct);
        this.bus.emit("position", { accountId: acct.id, event: "OPENED", position: this.positionInfo(pos) });
        this.emitAccount(acct, true);
        return reply({ status: "FILLED", orderId: res.order.id, positionId: pos.id, filledPrice: price });
      }

      // LIMIT / STOP
      const priceErr = validatePendingPrice(m.side, m.orderType, m.price, q);
      if (priceErr) return reject(priceErr, `bid ${q.bid} ask ${q.ask}`);
      const price = roundPrice(m.price as number, inst.digits);
      const stopErr = validateStops(m.side, price, m.stopLoss, m.takeProfit);
      if (stopErr) return reject(stopErr, `order price ${price}`);
      const margin = requiredMargin(volume, inst.contractSize, price, rate, rules.leverage);
      const free = roundCurrency(acct.equity - acct.marginUsed);
      if (margin > free) return reject("INSUFFICIENT_MARGIN", `required ${margin} free ${free}`);
      let row: Order;
      try {
        row = await prisma.order.create({
          data: {
            accountId: acct.id,
            symbol: inst.symbol,
            clientOrderId: m.clientOrderId,
            side: m.side,
            type: m.orderType,
            volume,
            price,
            stopLoss: m.stopLoss ?? null,
            takeProfit: m.takeProfit ?? null,
            status: "PENDING",
          },
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          const existing = await prisma.order.findUniqueOrThrow({ where: { accountId_clientOrderId: { accountId: acct.id, clientOrderId: m.clientOrderId } } });
          if (existing.status === "FILLED") return reply({ status: "FILLED", orderId: existing.id, positionId: existing.positionId ?? undefined, filledPrice: existing.filledPrice ?? undefined });
          if (existing.status === "PENDING") return reply({ status: "PENDING", orderId: existing.id });
          return reply({ status: "REJECTED", orderId: existing.id, reason: existing.rejectReason ?? existing.status });
        }
        throw err;
      }
      this.addPending(acct, row);
      this.emitAccount(acct, true);
      return reply({ status: "PENDING", orderId: row.id });
    } catch (err) {
      if (err instanceof NoFxPathError) return reject("NO_FX_PATH");
      this.log.error({ err: msg(err), accountId: acct.id, clientOrderId: m.clientOrderId }, "engine: order failed");
      return reply({ status: "REJECTED", reason: "INTERNAL" });
    }
  }

  private async triggerPending(acct: EngineAccount, order: EnginePending, q: EngineQuote) {
    if (acct.untracked || !acct.pending.has(order.id)) return;
    const inst = this.instruments.get(order.symbol);
    const rate = inst ? this.fx.rate(inst.quoteCurrency) : null;
    const price = inst ? roundPrice(pendingFillPrice(order.side, order.type, order.price, q), inst.digits) : order.price;
    const margin = inst && rate != null ? requiredMargin(order.volume, inst.contractSize, price, rate, acct.snapshot.leverage) : null;
    const free = roundCurrency(acct.equity - acct.marginUsed);
    const cancelReason = !inst ? "UNKNOWN_SYMBOL" : rate == null ? "NO_FX_PATH" : margin! > free ? "INSUFFICIENT_MARGIN" : null;
    if (cancelReason) {
      await prisma.order.updateMany({ where: { id: order.id, status: "PENDING" }, data: { status: "CANCELLED", rejectReason: cancelReason } });
      this.removePending(acct, order);
      this.bus.emit("order.result", { accountId: acct.id, clientOrderId: order.clientOrderId, status: "REJECTED", orderId: order.id, reason: cancelReason });
      this.log.warn({ orderId: order.id, cancelReason }, "engine: pending order cancelled at trigger");
      return;
    }
    try {
      const res = await openPosition({
        accountId: acct.id,
        symbol: order.symbol,
        side: order.side,
        volume: order.volume,
        entryPrice: price,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        marginUsed: margin!,
        entryTickTs: new Date(q.ts),
        feedSource: q.source,
        order: { clientOrderId: order.clientOrderId, type: order.type, price: order.price, existingOrderId: order.id },
      });
      this.removePending(acct, order);
      if (res.position && !acct.positions.has(res.position.id)) {
        const pos = this.addPosition(acct, res.position);
        this.bus.emit("position", { accountId: acct.id, event: "OPENED", position: this.positionInfo(pos) });
      }
      this.recompute(acct);
      this.bus.emit("order.result", { accountId: acct.id, clientOrderId: order.clientOrderId, status: "FILLED", orderId: order.id, positionId: res.position?.id, filledPrice: price });
      this.emitAccount(acct, true);
    } catch (err) {
      order.triggering = false;
      throw err;
    }
  }

  private async closePositionRequest(ctx: Ctx, m: Extract<ClientMessage, { type: "position.close" }>): Promise<ServerMessage[]> {
    const acct = await this.resolveAccount(ctx, m.accountId);
    if (!acct) return [{ type: "error", code: "NOT_FOUND", message: "Account not found or not tradable", ref: m.positionId }];
    const pos = acct.positions.get(m.positionId);
    if (!pos) return [{ type: "error", code: "NOT_FOUND", message: "Position not found", ref: m.positionId }];
    if (pos.closing || acct.breaching) return [{ type: "error", code: "CONFLICT", message: "Position is already closing", ref: m.positionId }];
    const q = this.freshQuote(pos.symbol);
    if (!q) return [{ type: "error", code: "MARKET_HALTED", message: this.marketState.reason ?? `${pos.symbol} has no fresh price`, ref: m.positionId }];
    const inst = this.instruments.get(pos.symbol);
    let volume = pos.volume;
    if (m.volume != null) {
      const requested = Number(m.volume);
      if (!Number.isFinite(requested) || requested <= 0 || requested > pos.volume + 1e-9) return [{ type: "error", code: "INVALID_VOLUME", message: "Close volume must be > 0 and <= position volume", ref: m.positionId }];
      if (requested < pos.volume - 1e-9) {
        const remaining = pos.volume - requested;
        if (inst && (validateVolume(requested, inst) || validateVolume(remaining, inst))) return [{ type: "error", code: "INVALID_VOLUME", message: "Partial close must respect the volume step and minimum", ref: m.positionId }];
        volume = roundVolume(requested);
      }
    }
    pos.closing = true;
    try {
      await this.closePositionInternal(acct, pos, markPrice(pos.side, q), "MANUAL", volume, ctx.userId, q);
      return [];
    } catch (err) {
      pos.closing = false;
      this.log.error({ err: msg(err), positionId: pos.id }, "engine: manual close failed");
      return [{ type: "error", code: "INTERNAL", message: "Close failed, please retry", ref: m.positionId }];
    }
  }

  /**
   * Closes (fully or partially) through the ledger and applies the returned
   * account row to memory. `pos.closing` must be set by the caller.
   */
  private async closePositionInternal(
    acct: EngineAccount,
    pos: EnginePosition,
    price: number,
    reason: CloseReason,
    volume: number | undefined,
    actorId: string | null,
    q: EngineQuote | undefined,
    keepTrackedOnFail = false,
  ): Promise<number | null> {
    if (!acct.positions.has(pos.id)) return null;
    const inst = this.instruments.get(pos.symbol);
    if (!inst) throw new Error(`instrument ${pos.symbol} not loaded`);
    const closeVolume = volume ?? pos.volume;
    const exit = roundPrice(price, inst.digits);
    const conv = this.fx.toAccountCurrency(grossPnlQuote(pos.side, pos.entryPrice, exit, closeVolume, inst.contractSize), inst.quoteCurrency);
    const commission = roundCurrency(inst.commissionPerLot * closeVolume);
    const res = await recordPositionClose({
      positionId: pos.id,
      closePrice: exit,
      closeReason: reason,
      grossProfit: conv.amount,
      commission,
      swap: 0,
      volume: closeVolume,
      exitTickTs: q ? new Date(q.ts) : undefined,
      fxRate: conv.rate,
      quoteCurrency: inst.quoteCurrency,
      actorId,
    });
    this.applyAccountRow(acct, res.account);
    if (res.position.status === "CLOSED") {
      this.removePosition(acct, pos);
      const info = this.positionInfo(pos);
      info.currentPrice = exit;
      info.floatingPnl = 0;
      info.marginUsed = 0;
      this.bus.emit("position", { accountId: acct.id, event: "CLOSED", position: info, closeReason: reason, realizedPnl: res.trade?.netProfit ?? undefined });
    } else {
      pos.volume = res.position.volume;
      pos.marginUsed = res.position.marginUsed;
      pos.closing = false;
      if (q) this.markPosition(pos, q);
      this.bus.emit("position", { accountId: acct.id, event: "MODIFIED", position: this.positionInfo(pos), closeReason: reason, realizedPnl: res.trade?.netProfit ?? undefined });
    }
    this.recompute(acct);
    void this.refreshTradingDays(acct);
    if (!TRADABLE.has(res.account.status) && !keepTrackedOnFail) {
      // evaluateAccount inside the ledger failed/passed the account.
      await this.cancelPendingOrders(acct, `ACCOUNT_${res.account.status}`);
      this.emitAccount(acct, true);
      this.untrack(acct.id, `status ${res.account.status} after close`);
      return res.trade?.netProfit ?? null;
    }
    this.emitAccount(acct, true);
    return res.trade?.netProfit ?? null;
  }

  private applyAccountRow(acct: EngineAccount, row: { status: string; balance: number; realizedPnl: number; highWaterMark: number; dailyAnchorBalance: number; dailyAnchorDate: Date; marginUsed: number }) {
    acct.status = row.status;
    acct.balance = row.balance;
    acct.realizedPnl = row.realizedPnl;
    acct.highWaterMark = Math.max(acct.highWaterMark, row.highWaterMark);
    acct.dailyAnchorBalance = row.dailyAnchorBalance;
    acct.dailyAnchorDate = row.dailyAnchorDate;
  }

  private async modifyPositionRequest(ctx: Ctx, m: Extract<ClientMessage, { type: "position.modify" }>): Promise<ServerMessage[]> {
    const acct = await this.resolveAccount(ctx, m.accountId);
    if (!acct) return [{ type: "error", code: "NOT_FOUND", message: "Account not found or not tradable", ref: m.positionId }];
    const pos = acct.positions.get(m.positionId);
    if (!pos) return [{ type: "error", code: "NOT_FOUND", message: "Position not found", ref: m.positionId }];
    if (pos.closing) return [{ type: "error", code: "CONFLICT", message: "Position is closing", ref: m.positionId }];
    const q = this.quotes.get(pos.symbol);
    const reference = q ? markPrice(pos.side, q) : pos.entryPrice;
    const stopLoss = m.stopLoss === undefined ? pos.stopLoss : m.stopLoss;
    const takeProfit = m.takeProfit === undefined ? pos.takeProfit : m.takeProfit;
    const err = validateStops(pos.side, reference, stopLoss, takeProfit);
    if (err) return [{ type: "error", code: err, message: `Stops must be on the correct side of ${reference}`, ref: m.positionId }];
    try {
      const row = await updatePositionRisk(pos.id, { stopLoss, takeProfit });
      pos.stopLoss = row.stopLoss;
      pos.takeProfit = row.takeProfit;
      this.bus.emit("position", { accountId: acct.id, event: "MODIFIED", position: this.positionInfo(pos) });
      this.emitAccount(acct, true);
      return [];
    } catch (e) {
      this.log.error({ err: msg(e), positionId: pos.id }, "engine: modify failed");
      return [{ type: "error", code: "INTERNAL", message: "Modify failed", ref: m.positionId }];
    }
  }

  /** Cancels the account's pending orders (those matching `filter`, default all); returns how many. */
  private async cancelPendingOrders(acct: EngineAccount, reason: string, filter: (o: EnginePending) => boolean = () => true): Promise<number> {
    const orders = Array.from(acct.pending.values()).filter(filter);
    if (orders.length === 0) return 0;
    try {
      await prisma.order.updateMany({ where: { id: { in: orders.map((o) => o.id) }, status: "PENDING" }, data: { status: "CANCELLED", rejectReason: reason.slice(0, 200) } });
    } catch (err) {
      this.log.error({ err: msg(err), accountId: acct.id }, "engine: cancelling pending orders failed");
    }
    for (const o of orders) {
      this.removePending(acct, o);
      this.bus.emit("order.result", { accountId: acct.id, clientOrderId: o.clientOrderId, status: "REJECTED", orderId: o.id, reason });
    }
    return orders.length;
  }

  private async closeAllAndUntrack(acct: EngineAccount, reason: "ADMIN", why: string) {
    await this.enqueue(acct.id, async () => {
      for (const pos of Array.from(acct.positions.values())) {
        const q = this.quotes.get(pos.symbol);
        if (!q) {
          this.log.error({ positionId: pos.id }, "engine: no quote to close position for untracked account");
          continue;
        }
        pos.closing = true;
        try {
          await this.closePositionInternal(acct, pos, markPrice(pos.side, q), reason, undefined, null, q, true);
        } catch (err) {
          pos.closing = false;
          this.log.error({ err: msg(err), positionId: pos.id }, "engine: admin close failed");
        }
      }
      await this.cancelPendingOrders(acct, `ACCOUNT_${why.toUpperCase().replace(/\s+/g, "_")}`);
      this.emitAccount(acct, true);
      this.untrack(acct.id, why);
    });
  }

  // ---------------------------------------------------------------------
  // persistence / reconcile
  // ---------------------------------------------------------------------

  private async flushAccount(acct: EngineAccount) {
    const marks = Array.from(acct.positions.values()).map((p) => ({ positionId: p.id, currentPrice: p.currentPrice ?? p.entryPrice, floatingPnl: p.floatingPnl }));
    await persistMarks(marks, [{ accountId: acct.id, equity: acct.equity, marginUsed: acct.marginUsed }]);
    for (const p of acct.positions.values()) p.dirty = false;
    acct.dirty = false;
  }

  /** Persists changed marks/equity (throttled by the caller) and equity snapshots. */
  async flush(): Promise<void> {
    const marks: { positionId: string; currentPrice: number; floatingPnl: number }[] = [];
    const accounts: { accountId: string; equity: number; marginUsed: number }[] = [];
    const now = this.now();
    const snapshots: EngineAccount[] = [];
    for (const acct of this.accounts.values()) {
      for (const p of acct.positions.values()) {
        if (p.dirty && !p.closing) {
          marks.push({ positionId: p.id, currentPrice: p.currentPrice ?? p.entryPrice, floatingPnl: p.floatingPnl });
          p.dirty = false;
        }
      }
      if (acct.dirty) {
        accounts.push({ accountId: acct.id, equity: acct.equity, marginUsed: acct.marginUsed });
        acct.dirty = false;
      }
      const moved = acct.lastSnapshotEquity > 0 ? Math.abs(acct.equity - acct.lastSnapshotEquity) / acct.lastSnapshotEquity >= SNAPSHOT_MIN_MOVE : acct.equity !== acct.lastSnapshotEquity;
      const aged = acct.positions.size > 0 && now - acct.lastSnapshotAt >= SNAPSHOT_MAX_AGE_MS;
      if (moved || aged) snapshots.push(acct);
    }
    if (marks.length > 0 || accounts.length > 0) await persistMarks(marks, accounts);
    for (const acct of snapshots) {
      acct.lastSnapshotEquity = acct.equity;
      acct.lastSnapshotAt = now;
      await recordEquitySnapshot(acct.id, acct.balance, acct.equity, acct.marginUsed);
    }
  }

  /** Every 5 s: drop accounts the web app suspended/failed and positions closed elsewhere. */
  async reconcile(): Promise<void> {
    const ids = Array.from(this.accounts.keys());
    if (ids.length === 0) return;
    const rows = await prisma.tradingAccount.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
    const seen = new Set<string>();
    for (const row of rows) {
      seen.add(row.id);
      const acct = this.accounts.get(row.id);
      if (!acct || acct.breaching) continue;
      if (!TRADABLE.has(row.status)) await this.closeAllAndUntrack(acct, "ADMIN", `status ${row.status}`);
    }
    for (const id of ids) if (!seen.has(id)) this.untrack(id, "deleted");

    const positionIds: string[] = [];
    for (const acct of this.accounts.values()) for (const p of acct.positions.values()) if (!p.closing) positionIds.push(p.id);
    if (positionIds.length === 0) return;
    const closed = await prisma.position.findMany({ where: { id: { in: positionIds }, status: "CLOSED" }, select: { id: true, accountId: true } });
    for (const c of closed) {
      const acct = this.accounts.get(c.accountId);
      const pos = acct?.positions.get(c.id);
      if (!acct || !pos || pos.closing) continue;
      await this.enqueue(acct.id, async () => {
        if (pos.closing || !acct.positions.has(pos.id)) return;
        this.removePosition(acct, pos);
        const fresh = await loadEngineAccount(acct.id);
        if (fresh) this.mergeRow(acct, fresh);
        this.recompute(acct);
        this.emitAccount(acct, true);
        this.log.info({ positionId: pos.id, accountId: acct.id }, "engine: position closed outside the engine, dropped");
      });
    }
  }

  /** Every 30 s: full merge from the DB plus discovery of newly activated accounts. */
  async reloadAllAccounts(): Promise<void> {
    const rows = await loadEngineAccounts();
    for (const row of rows) {
      const acct = this.accounts.get(row.id);
      if (acct) {
        if (acct.breaching) continue;
        await this.enqueue(acct.id, async () => {
          if (acct.untracked) return;
          const fresh = await loadEngineAccount(acct.id);
          if (!fresh) return this.untrack(acct.id, "deleted");
          if (!TRADABLE.has(fresh.status)) return this.closeAllAndUntrack(acct, "ADMIN", `status ${fresh.status}`);
          this.mergeRow(acct, fresh);
          this.emitAccount(acct);
        });
      } else {
        await this.trackFromRow(row);
      }
    }
  }

  // ---------------------------------------------------------------------
  // views
  // ---------------------------------------------------------------------

  positionInfo(p: EnginePosition): PositionInfo {
    return {
      id: p.id,
      accountId: p.accountId,
      symbol: p.symbol,
      side: p.side,
      volume: p.volume,
      entryPrice: p.entryPrice,
      currentPrice: p.currentPrice,
      stopLoss: p.stopLoss,
      takeProfit: p.takeProfit,
      floatingPnl: p.floatingPnl,
      marginUsed: p.marginUsed,
      openedAt: p.openedAt.toISOString(),
    };
  }

  accountState(acct: EngineAccount): AccountState {
    const { ddFloor, dlFloor } = this.floors(acct);
    const dailyLimit = Number.isFinite(dlFloor) ? roundCurrency(acct.dailyAnchorBalance - dlFloor) : 0;
    const target = acct.snapshot.profitTarget != null && acct.snapshot.profitTarget > 0 ? roundCurrency(acct.startingBalance * (acct.snapshot.profitTarget / 100)) : null;
    return {
      accountId: acct.id,
      status: acct.status,
      currency: acct.snapshot.accountCurrency || this.fx.accountCurrency,
      balance: roundCurrency(acct.balance),
      equity: roundCurrency(acct.equity),
      marginUsed: roundCurrency(acct.marginUsed),
      freeMargin: roundCurrency(acct.equity - acct.marginUsed),
      realizedPnl: roundCurrency(acct.realizedPnl),
      floatingPnl: roundCurrency(acct.floating),
      dailyAnchor: roundCurrency(acct.dailyAnchorBalance),
      dailyLossUsed: roundCurrency(Math.max(0, acct.dailyAnchorBalance - acct.equity)),
      dailyLossLimit: dailyLimit,
      drawdownFloor: Number.isFinite(ddFloor) ? ddFloor : 0,
      drawdownRemaining: Number.isFinite(ddFloor) ? roundCurrency(acct.equity - ddFloor) : acct.equity,
      profitTarget: target,
      profitProgress: target ? Math.round((acct.realizedPnl / target) * 10000) / 100 : null,
      tradingDays: acct.tradingDays,
      minTradingDays: acct.snapshot.minTradingDays ?? 0,
      positions: Array.from(acct.positions.values()).map((p) => this.positionInfo(p)),
    };
  }

  getAccountState(accountId: string): AccountState | null {
    const acct = this.accounts.get(accountId);
    return acct ? this.accountState(acct) : null;
  }

  private emitAccount(acct: EngineAccount, immediate = false) {
    if (immediate) {
      if (acct.emitTimer) clearTimeout(acct.emitTimer);
      acct.emitTimer = null;
      this.bus.emit("account", this.accountState(acct));
      return;
    }
    if (acct.emitTimer) return;
    acct.emitTimer = setTimeout(() => {
      acct.emitTimer = null;
      if (!acct.untracked) this.bus.emit("account", this.accountState(acct));
    }, ACCOUNT_EMIT_MS);
  }

  setLastSweep(result: unknown) {
    this.lastSweep = result;
  }

  status() {
    const sorted = [...this.lag].sort((a, b) => a - b);
    const p = (f: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] : 0);
    let openPositions = 0;
    for (const a of this.accounts.values()) openPositions += a.positions.size;
    return {
      marketState: this.marketState,
      manualHalt: this.manualHalt,
      instruments: this.instruments.size,
      trackedAccounts: this.accounts.size,
      openPositions,
      inflight: this.inflight,
      lagMs: { samples: sorted.length, p50: p(0.5), p95: p(0.95), max: sorted[sorted.length - 1] ?? 0 },
      fx: this.fx.usdRate(),
      lastSweep: this.lastSweep,
      started: this.started,
      news: { windowMinutes: this.newsWindowMs / 60_000, upcomingHighImpact: this.newsEvents.filter((e) => e.scheduledAt + this.newsWindowMs >= this.now()).length },
    };
  }

  /** Test/diagnostic access to the effective quote. */
  quote(symbol: string): EngineQuote | undefined {
    return this.quotes.get(symbol);
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** In-app (and Telegram) notice that a holding rule flattened the account, in the trader's language. */
async function notifyRuleApplied(acct: EngineAccount, rule: HoldingRule, closed: number, cancelled: number) {
  const user = await prisma.user.findUnique({ where: { id: acct.userId }, select: { locale: true } });
  const messages = dictionaries[isLocale(user?.locale) ? user!.locale : "en"];
  const t = (key: MessageKey, vars?: Record<string, string | number>) => interpolate(messages[key] ?? key, vars);
  const name = acct.snapshot.name ?? acct.id;
  const parts = [t(rule === "WEEKEND" ? "trading.notify.weekend.message" : "trading.notify.overnight.message", { account: name, count: closed })];
  if (cancelled > 0) parts.push(t("trading.notify.ordersCancelled", { count: cancelled }));
  await notifyUser({
    userId: acct.userId,
    title: t(rule === "WEEKEND" ? "trading.notify.weekend.title" : "trading.notify.overnight.title"),
    message: parts.join(" "),
    type: "warning",
    link: `/accounts/${acct.id}`,
  });
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

async function readKillSwitch(): Promise<boolean> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: "trading.halted" } });
    return Boolean((row?.value as { halted?: unknown } | null)?.halted);
  } catch {
    return false;
  }
}

export type { TradeSide };
