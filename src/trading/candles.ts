import { TIMEFRAMES, TIMEFRAME_SECONDS, type Bar, type Tick, type Timeframe } from "@/trading/protocol";

/**
 * Builds OHLC bars from ticks, in memory. 1m bars are the unit of storage;
 * 5m/15m/1h/4h/1d are derived live so the terminal gets a moving current bar
 * on every timeframe without the web app aggregating anything on the hot
 * path. Bar.time is the bar open time in epoch milliseconds (same unit as
 * Tick.ts). Price = mid ((bid+ask)/2), volume = tick count.
 *
 * Pure: no timers, no database. See candleStore.ts for persistence.
 */

export type BarEvent = { symbol: string; tf: Timeframe; bar: Bar };

export function bucketStart(ts: number, tf: Timeframe): number {
  const ms = TIMEFRAME_SECONDS[tf] * 1000;
  return Math.floor(ts / ms) * ms;
}

export function midPrice(t: Pick<Tick, "bid" | "ask">): number {
  return (t.bid + t.ask) / 2;
}

function newBar(time: number, price: number, volume = 1): Bar {
  return { time, open: price, high: price, low: price, close: price, volume };
}

function mergeInto(bar: Bar, price: number, volume: number) {
  if (price > bar.high) bar.high = price;
  if (price < bar.low) bar.low = price;
  bar.close = price;
  bar.volume += volume;
}

/** Aggregates ascending 1m bars into the given timeframe (used for restore and by tests). */
export function aggregateBars(bars1m: Bar[], tf: Timeframe): Bar[] {
  const out: Bar[] = [];
  for (const b of bars1m) {
    const t = bucketStart(b.time, tf);
    const last = out[out.length - 1];
    if (last && last.time === t) {
      if (b.high > last.high) last.high = b.high;
      if (b.low < last.low) last.low = b.low;
      last.close = b.close;
      last.volume += b.volume;
    } else {
      out.push({ time: t, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
    }
  }
  return out;
}

export class CandleBuilder {
  private bars = new Map<string, Map<Timeframe, Bar>>();
  private digits = new Map<string, number>();

  constructor(private readonly timeframes: Timeframe[] = TIMEFRAMES) {}

  setDigits(symbol: string, digits: number) {
    this.digits.set(symbol, digits);
  }

  /**
   * Seeds the builder from stored 1m bars (ascending, ideally from the start
   * of the current daily bucket) so a restart continues the open bars instead
   * of starting a gap.
   */
  restore(symbol: string, bars1m: Bar[]) {
    if (bars1m.length === 0) return;
    const sorted = [...bars1m].sort((a, b) => a.time - b.time);
    const map = new Map<Timeframe, Bar>();
    for (const tf of this.timeframes) {
      const agg = aggregateBars(sorted, tf);
      const last = agg[agg.length - 1];
      if (last) map.set(tf, { ...last });
    }
    this.bars.set(symbol, map);
  }

  current(symbol: string, tf: Timeframe): Bar | undefined {
    const bar = this.bars.get(symbol)?.get(tf);
    return bar ? { ...bar } : undefined;
  }

  /**
   * Applies a tick. Returns the updated current bar for every timeframe, plus
   * the 1m bar that just closed (if the tick opened a new minute) so the
   * caller can persist it.
   */
  onTick(tick: Tick): { updated: BarEvent[]; closed1m: Bar | null } {
    const scale = 10 ** (this.digits.get(tick.symbol) ?? 5);
    const price = Math.round(midPrice(tick) * scale) / scale;
    let map = this.bars.get(tick.symbol);
    if (!map) {
      map = new Map();
      this.bars.set(tick.symbol, map);
    }
    const updated: BarEvent[] = [];
    let closed1m: Bar | null = null;

    for (const tf of this.timeframes) {
      const t = bucketStart(tick.ts, tf);
      const cur = map.get(tf);
      if (cur && cur.time === t) {
        mergeInto(cur, price, 1);
        updated.push({ symbol: tick.symbol, tf, bar: { ...cur } });
      } else if (cur && cur.time > t) {
        // Out-of-order tick from before the current bar: ignore for bar
        // purposes rather than corrupting the series.
        continue;
      } else {
        if (cur && tf === "1m") closed1m = { ...cur };
        const bar = newBar(t, price);
        map.set(tf, bar);
        updated.push({ symbol: tick.symbol, tf, bar: { ...bar } });
      }
    }
    return { updated, closed1m };
  }
}
