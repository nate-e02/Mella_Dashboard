import { BinanceProvider } from "./binance";
import { CTraderProvider } from "./ctrader";
import { StubProvider } from "./stub";
import { TraderMadeProvider } from "./tradermade";
import type { FeedLogger, MarketDataProvider } from "./types";

export type FeedSource = "STUB" | "BINANCE" | "CTRADER" | "TRADERMADE";

/** "STUB", "STUB2", "STUB3", ...: simulated feeds. Extra instances stand in for a backup feed in development. */
export const STUB_SOURCE = /^STUB\d*$/;

const DEFAULT_STUB_SEED = 20260923;

export function createProvider(source: string, opts: { log?: FeedLogger; stubSeed?: number } = {}): MarketDataProvider {
  const name = source.toUpperCase();
  if (STUB_SOURCE.test(name)) {
    // Each extra stub instance gets its own deterministic seed so the two streams differ.
    const n = Number(name.slice(4)) || 1;
    return new StubProvider({ log: opts.log, name, seed: (opts.stubSeed ?? DEFAULT_STUB_SEED) + (n - 1) * 7919 });
  }
  switch (name) {
    case "BINANCE":
      return new BinanceProvider({ log: opts.log });
    case "CTRADER":
      return new CTraderProvider({ log: opts.log });
    case "TRADERMADE":
      return new TraderMadeProvider({ log: opts.log });
    default:
      throw new Error(`Unknown feed source "${source}" (expected STUB, STUB2.., BINANCE, CTRADER or TRADERMADE)`);
  }
}

export type { FeedHealth, FeedLogger, FeedSymbol, MarketDataProvider } from "./types";
