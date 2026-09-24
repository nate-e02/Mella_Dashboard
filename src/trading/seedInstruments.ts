import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Default instrument catalogue. FX/metals come from cTrader (feedSymbol =
 * our symbol, which the STUB feed also understands); crypto from the Binance
 * public stream (feedSymbol = Binance pair, quoted in USDT which fx.ts treats
 * as USD).
 */

const fx = (symbol: string, sortOrder: number, extra: Partial<Prisma.InstrumentCreateInput> = {}): Prisma.InstrumentCreateInput => ({
  symbol,
  displayName: `${symbol.slice(0, 3)}/${symbol.slice(3)}`,
  category: "FOREX",
  baseCurrency: symbol.slice(0, 3),
  quoteCurrency: symbol.slice(3),
  digits: symbol.endsWith("JPY") ? 3 : 5,
  contractSize: 100_000,
  minVolume: 0.01,
  maxVolume: 50,
  volumeStep: 0.01,
  feedSource: "CTRADER",
  feedSymbol: symbol,
  sortOrder,
  ...extra,
});

export const DEFAULT_INSTRUMENTS: Prisma.InstrumentCreateInput[] = [
  fx("EURUSD", 10),
  fx("GBPUSD", 20),
  fx("USDJPY", 30),
  fx("AUDUSD", 40),
  fx("USDCAD", 50),
  fx("USDCHF", 60),
  fx("NZDUSD", 70),
  fx("EURGBP", 80),
  fx("EURJPY", 90),
  fx("GBPJPY", 100),
  {
    symbol: "XAUUSD",
    displayName: "Gold / USD",
    category: "METAL",
    baseCurrency: "XAU",
    quoteCurrency: "USD",
    digits: 2,
    contractSize: 100,
    minVolume: 0.01,
    maxVolume: 20,
    volumeStep: 0.01,
    feedSource: "CTRADER",
    feedSymbol: "XAUUSD",
    sortOrder: 200,
  },
  {
    symbol: "XAGUSD",
    displayName: "Silver / USD",
    category: "METAL",
    baseCurrency: "XAG",
    quoteCurrency: "USD",
    digits: 3,
    contractSize: 5_000,
    minVolume: 0.01,
    maxVolume: 20,
    volumeStep: 0.01,
    feedSource: "CTRADER",
    feedSymbol: "XAGUSD",
    sortOrder: 210,
  },
  {
    symbol: "BTCUSD",
    displayName: "Bitcoin / USD",
    category: "CRYPTO",
    baseCurrency: "BTC",
    quoteCurrency: "USD",
    digits: 2,
    contractSize: 1,
    minVolume: 0.01,
    maxVolume: 10,
    volumeStep: 0.01,
    feedSource: "BINANCE",
    feedSymbol: "BTCUSDT",
    sortOrder: 300,
  },
  {
    symbol: "ETHUSD",
    displayName: "Ethereum / USD",
    category: "CRYPTO",
    baseCurrency: "ETH",
    quoteCurrency: "USD",
    digits: 2,
    contractSize: 1,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    feedSource: "BINANCE",
    feedSymbol: "ETHUSDT",
    sortOrder: 310,
  },
];

/** Creates any missing default instrument. Existing rows are left untouched (admins may have tuned them). */
export async function ensureDefaultInstruments(): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;
  for (const inst of DEFAULT_INSTRUMENTS) {
    const before = await prisma.instrument.findUnique({ where: { symbol: inst.symbol }, select: { symbol: true } });
    await prisma.instrument.upsert({ where: { symbol: inst.symbol }, create: inst, update: {} });
    if (before) existing += 1;
    else created += 1;
  }
  return { created, existing };
}
