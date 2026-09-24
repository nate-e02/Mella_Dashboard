import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TIMEFRAME_SECONDS, type Bar, type InstrumentInfo, type Timeframe } from "@/trading/protocol";

/**
 * Read-side market data for the terminal: the instrument catalogue and
 * historical candles. Only 1-minute bars are persisted (by the worker's
 * candle builder); every other timeframe is aggregated from them in SQL so a
 * 4h chart never loads 240x the rows it displays into Node.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** Bucket start (unix seconds) that a timestamp (unix seconds) falls into for a timeframe. Buckets are aligned to UTC epoch, so "1d" buckets start at 00:00 UTC. */
export function bucketStart(tsSeconds: number, tf: Timeframe): number {
  const size = TIMEFRAME_SECONDS[tf];
  return Math.floor(tsSeconds / size) * size;
}

export function toInstrumentInfo(row: {
  symbol: string;
  displayName: string;
  category: InstrumentInfo["category"];
  baseCurrency: string;
  quoteCurrency: string;
  digits: number;
  contractSize: number;
  minVolume: number;
  maxVolume: number;
  volumeStep: number;
  commissionPerLot: number;
}): InstrumentInfo {
  return {
    symbol: row.symbol,
    displayName: row.displayName,
    category: row.category,
    baseCurrency: row.baseCurrency,
    quoteCurrency: row.quoteCurrency,
    digits: row.digits,
    contractSize: row.contractSize,
    minVolume: row.minVolume,
    maxVolume: row.maxVolume,
    volumeStep: row.volumeStep,
    commissionPerLot: row.commissionPerLot,
  };
}

/** Enabled instruments in display order. */
export async function listInstruments(db: Db = prisma): Promise<InstrumentInfo[]> {
  const rows = await db.instrument.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: "asc" }, { symbol: "asc" }],
    select: {
      symbol: true,
      displayName: true,
      category: true,
      baseCurrency: true,
      quoteCurrency: true,
      digits: true,
      contractSize: true,
      minVolume: true,
      maxVolume: true,
      volumeStep: true,
      commissionPerLot: true,
    },
  });
  return rows.map(toInstrumentInfo);
}

/**
 * Latest known quote-currency -> account-currency (ETB) conversion rates,
 * keyed by base currency (e.g. { USD: 135.2 }). Used by the terminal to show
 * margin/pip estimates in ETB; the engine applies its own rate at fill time.
 */
export async function latestFxRates(accountCurrency = "ETB", db: Db = prisma): Promise<Record<string, number>> {
  const rows = await db.fxRate.findMany({
    where: { quote: accountCurrency },
    orderBy: [{ base: "asc" }, { effectiveAt: "desc" }],
    distinct: ["base"],
    select: { base: true, rate: true },
  });
  const rates: Record<string, number> = { [accountCurrency]: 1 };
  for (const r of rows) rates[r.base] = r.rate;
  return rates;
}

type AggRow = { time: number; open: number; high: number; low: number; close: number; volume: number };

/**
 * Historical candles for a symbol, ascending by time, `time` in unix seconds
 * (what lightweight-charts expects). `before` (exclusive) pages backwards:
 * pass the oldest bar you already have to fetch the ones before it.
 */
export async function getBars(
  symbol: string,
  tf: Timeframe,
  opts: { limit?: number; before?: Date } = {},
  db: Db = prisma,
): Promise<Bar[]> {
  const limit = Math.max(1, Math.min(1500, Math.floor(opts.limit ?? 500)));
  const size = TIMEFRAME_SECONDS[tf];

  if (tf === "1m") {
    const rows = await db.bar.findMany({
      where: { symbol, timeframe: "1m", ...(opts.before ? { time: { lt: opts.before } } : {}) },
      orderBy: { time: "desc" },
      take: limit,
      select: { time: true, open: true, high: true, low: true, close: true, volume: true },
    });
    return rows
      .reverse()
      .map((r) => ({ time: Math.floor(r.time.getTime() / 1000), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
  }

  // Align `before` to a bucket boundary so a partially-built bucket is never
  // returned twice across pages (the client always passes a bucket start).
  const beforeCondition = opts.before
    ? Prisma.sql`AND "time" < ${new Date(bucketStart(Math.floor(opts.before.getTime() / 1000), tf) * 1000)}`
    : Prisma.empty;

  const rows = await db.$queryRaw<AggRow[]>`
    SELECT
      extract(epoch FROM bucket)::float8 AS time,
      open, high, low, close, volume
    FROM (
      SELECT
        to_timestamp(floor(extract(epoch FROM "time") / ${size}::float8) * ${size}::float8) AS bucket,
        (array_agg(open ORDER BY "time" ASC))[1]::float8   AS open,
        max(high)::float8                                    AS high,
        min(low)::float8                                     AS low,
        (array_agg(close ORDER BY "time" DESC))[1]::float8  AS close,
        coalesce(sum(volume), 0)::float8                     AS volume
      FROM "Bar"
      WHERE symbol = ${symbol} AND timeframe = '1m' ${beforeCondition}
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT ${limit}
    ) t
    ORDER BY bucket ASC
  `;

  return rows.map((r) => ({
    time: Math.round(Number(r.time)),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  }));
}
