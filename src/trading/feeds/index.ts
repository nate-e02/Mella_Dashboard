import { BinanceProvider } from "./binance";
import { CTraderProvider } from "./ctrader";
import { StubProvider } from "./stub";
import type { FeedLogger, MarketDataProvider } from "./types";

export type FeedSource = "STUB" | "BINANCE" | "CTRADER";

export function createProvider(source: string, opts: { log?: FeedLogger; stubSeed?: number } = {}): MarketDataProvider {
  switch (source.toUpperCase()) {
    case "STUB":
      return new StubProvider({ log: opts.log, seed: opts.stubSeed });
    case "BINANCE":
      return new BinanceProvider({ log: opts.log });
    case "CTRADER":
      return new CTraderProvider({ log: opts.log });
    default:
      throw new Error(`Unknown feed source "${source}" (expected STUB, BINANCE or CTRADER)`);
  }
}

export type { FeedHealth, FeedLogger, FeedSymbol, MarketDataProvider } from "./types";
