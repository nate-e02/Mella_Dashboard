import type { Bar, Tick, Timeframe } from "@/trading/protocol";

/** One instrument as the feed layer sees it: our symbol plus the provider's name for it. */
export type FeedSymbol = {
  /** Our symbol, e.g. EURUSD */
  symbol: string;
  /** The provider's symbol, e.g. "EUR/USD" (cTrader) or "BTCUSDT" (Binance) */
  feedSymbol: string;
  digits: number;
};

export type FeedHealth = {
  connected: boolean;
  lastTickAt: number | null;
  symbols: Record<string, { lastTickAt: number | null }>;
};

export interface MarketDataProvider {
  readonly name: string;
  start(symbols: FeedSymbol[]): Promise<void>;
  stop(): Promise<void>;
  onTick(cb: (t: Tick) => void): void;
  health(): FeedHealth;
  /** Optional historical backfill; `feedSymbol` is the provider's symbol name. */
  getBars?(feedSymbol: string, tf: Timeframe, from: Date, to: Date): Promise<Bar[]>;
}

export type FeedLogger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
};

export const silentLogger: FeedLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** Exponential backoff with full jitter: 1s -> 30s. */
export function backoffDelay(attempt: number, baseMs = 1000, maxMs = 30_000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}
