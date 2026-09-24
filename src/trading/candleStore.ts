import { prisma } from "@/lib/prisma";
import type { Bar } from "@/trading/protocol";
import type { CandleBuilder } from "./candles";
import { bucketStart } from "./candles";

/**
 * Persistence for 1m bars: upsert at bar close and every `flushMs` for the
 * open bar. Higher timeframes are never stored (the web app aggregates them
 * in SQL from 1m).
 */

export async function loadBarsSince(symbols: string[], sinceMs: number): Promise<Map<string, Bar[]>> {
  const rows = await prisma.bar.findMany({
    where: { symbol: { in: symbols }, timeframe: "1m", time: { gte: new Date(sinceMs) } },
    orderBy: { time: "asc" },
  });
  const out = new Map<string, Bar[]>();
  for (const r of rows) {
    const list = out.get(r.symbol) ?? [];
    list.push({ time: r.time.getTime(), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume });
    out.set(r.symbol, list);
  }
  return out;
}

/** Loads the last stored 1m bar per symbol (fallback when the day bucket is empty). */
export async function loadLastBar(symbol: string): Promise<Bar | null> {
  const r = await prisma.bar.findFirst({ where: { symbol, timeframe: "1m" }, orderBy: { time: "desc" } });
  return r ? { time: r.time.getTime(), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume } : null;
}

export async function upsertBars(entries: { symbol: string; bar: Bar }[]): Promise<void> {
  if (entries.length === 0) return;
  await prisma.$transaction(
    entries.map(({ symbol, bar }) =>
      prisma.bar.upsert({
        where: { symbol_timeframe_time: { symbol, timeframe: "1m", time: new Date(bar.time) } },
        create: { symbol, timeframe: "1m", time: new Date(bar.time), open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume },
        update: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume },
      }),
    ),
  );
}

/** Restores every symbol's current bars from the DB so a restart creates no gap. */
export async function restoreBuilder(builder: CandleBuilder, symbols: string[], now = Date.now()) {
  const dayStart = bucketStart(now, "1d");
  const byDay = await loadBarsSince(symbols, dayStart);
  for (const symbol of symbols) {
    let bars = byDay.get(symbol) ?? [];
    if (bars.length === 0) {
      const last = await loadLastBar(symbol);
      if (last) bars = [last];
    }
    builder.restore(symbol, bars);
  }
}

export class CandlePersister {
  private dirty = new Map<string, Bar>(); // key symbol -> open 1m bar
  private closed: { symbol: string; bar: Bar }[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(
    private readonly log: { error: (o: unknown, m?: string) => void },
    private readonly flushMs = 5_000,
  ) {}

  /** Call with the output of CandleBuilder.onTick. */
  track(symbol: string, current1m: Bar | undefined, closed1m: Bar | null) {
    if (closed1m) this.closed.push({ symbol, bar: closed1m });
    if (current1m) this.dirty.set(symbol, current1m);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.flushMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    const batch = [...this.closed, ...Array.from(this.dirty.entries()).map(([symbol, bar]) => ({ symbol, bar }))];
    this.closed = [];
    this.dirty.clear();
    try {
      await upsertBars(batch);
    } catch (err) {
      this.log.error({ err: (err as Error).message, bars: batch.length }, "candles: failed to persist bars");
    } finally {
      this.flushing = false;
    }
  }
}
