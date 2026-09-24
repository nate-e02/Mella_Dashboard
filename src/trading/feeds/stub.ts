import type { Tick } from "@/trading/protocol";
import { silentLogger, type FeedHealth, type FeedLogger, type FeedSymbol, type MarketDataProvider } from "./types";

/**
 * SIMULATED market data for local development and tests. A seeded,
 * mean-reverting random walk per symbol with a realistic spread. Never use
 * this for a customer-facing environment: prices are invented.
 */

/** Deterministic 32-bit PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const START_PRICES: Record<string, number> = {
  EURUSD: 1.085,
  GBPUSD: 1.27,
  USDJPY: 149.5,
  AUDUSD: 0.655,
  USDCAD: 1.36,
  USDCHF: 0.885,
  NZDUSD: 0.605,
  EURGBP: 0.855,
  EURJPY: 162.2,
  GBPJPY: 189.8,
  XAUUSD: 2350,
  XAGUSD: 28.5,
  BTCUSD: 64000,
  ETHUSD: 3400,
};

type SymbolState = {
  sym: FeedSymbol;
  base: number;
  mid: number;
  spread: number;
  /** per-tick volatility as a fraction of price */
  vol: number;
  lastTickAt: number | null;
  timer: NodeJS.Timeout | null;
};

/** Spread and volatility profile by symbol family. */
export function stubProfile(symbol: string, price: number): { spread: number; vol: number } {
  if (/^XAU/.test(symbol)) return { spread: 0.3, vol: 0.00012 };
  if (/^XAG/.test(symbol)) return { spread: 0.03, vol: 0.00015 };
  if (/^(BTC|ETH|SOL|XRP|BNB)/.test(symbol)) return { spread: price * 0.0002, vol: 0.0003 };
  if (/JPY$/.test(symbol)) return { spread: 0.012, vol: 0.00006 }; // 1.2 pips, pip = 0.01
  return { spread: 0.00012, vol: 0.00006 }; // 1.2 pips, pip = 0.0001
}

export class StubProvider implements MarketDataProvider {
  /** "STUB" by default; a second instance ("STUB2", different seed) stands in for a backup feed in development. */
  readonly name: string;
  private listeners: ((t: Tick) => void)[] = [];
  private state = new Map<string, SymbolState>();
  private rng: () => number;
  private running = false;

  constructor(
    private readonly opts: { seed?: number; minTicksPerSec?: number; maxTicksPerSec?: number; log?: FeedLogger; name?: string } = {},
  ) {
    this.name = opts.name ?? "STUB";
    this.rng = mulberry32(opts.seed ?? 20260923);
  }

  async start(symbols: FeedSymbol[]): Promise<void> {
    const log = this.opts.log ?? silentLogger;
    log.warn({ source: this.name, symbols: symbols.map((s) => s.symbol) }, "STUB FEED: prices are SIMULATED random-walk data, not real market prices");
    this.running = true;
    for (const sym of symbols) {
      const base = START_PRICES[sym.symbol] ?? 1;
      const { spread, vol } = stubProfile(sym.symbol, base);
      const st: SymbolState = { sym, base, mid: base, spread, vol, lastTickAt: null, timer: null };
      this.state.set(sym.symbol, st);
      this.schedule(st);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const st of this.state.values()) {
      if (st.timer) clearTimeout(st.timer);
      st.timer = null;
    }
  }

  onTick(cb: (t: Tick) => void): void {
    this.listeners.push(cb);
  }

  health(): FeedHealth {
    const symbols: FeedHealth["symbols"] = {};
    let last: number | null = null;
    for (const [s, st] of this.state) {
      symbols[s] = { lastTickAt: st.lastTickAt };
      if (st.lastTickAt && (!last || st.lastTickAt > last)) last = st.lastTickAt;
    }
    return { connected: this.running, lastTickAt: last, symbols };
  }

  /** Produces the next tick for a symbol synchronously (used by tests and the scheduler). */
  nextTick(symbol: string, now = Date.now()): Tick {
    const st = this.state.get(symbol);
    if (!st) throw new Error(`stub: unknown symbol ${symbol}`);
    // Mean-reverting random walk: pull back toward the base price so the
    // simulated series stays plausible over hours of running.
    const noise = (this.rng() + this.rng() + this.rng() - 1.5) * 2; // roughly N(0, ~1)
    const step = st.mid * st.vol * noise + (st.base - st.mid) * 0.002;
    st.mid = Math.max(st.base * 0.5, st.mid + step);
    const half = st.spread / 2;
    const scale = 10 ** st.sym.digits;
    const bid = Math.round((st.mid - half) * scale) / scale;
    const ask = Math.round((st.mid + half) * scale) / scale;
    st.lastTickAt = now;
    return { symbol, bid, ask, ts: now, source: this.name };
  }

  private schedule(st: SymbolState) {
    if (!this.running) return;
    const minRate = this.opts.minTicksPerSec ?? 3;
    const maxRate = this.opts.maxTicksPerSec ?? 6;
    const rate = minRate + this.rng() * (maxRate - minRate);
    st.timer = setTimeout(() => {
      if (!this.running) return;
      const tick = this.nextTick(st.sym.symbol);
      for (const cb of this.listeners) {
        try {
          cb(tick);
        } catch {
          // listener errors must never stop the feed
        }
      }
      this.schedule(st);
    }, 1000 / rate);
  }
}
