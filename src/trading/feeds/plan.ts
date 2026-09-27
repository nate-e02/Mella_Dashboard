import type { FeedRoute } from "./router";
import type { FeedSymbol } from "./types";

/**
 * Which provider serves which instrument, as primary and as backup. A
 * provider may be the primary for some symbols and the backup for others;
 * the worker starts one provider per source in the union and the FeedRouter
 * decides which of a symbol's two streams reaches the engine.
 */

export type FeedEnv = Record<string, string | undefined>;

export type FeedInstrument = {
  symbol: string;
  feedSource: string;
  feedSymbol: string;
  backupFeedSource?: string | null;
  backupFeedSymbol?: string | null;
  digits: number;
  category?: string | null;
};

const STUB_LIKE = /^STUB\d*$/;

/** FX/metals providers. Crypto stays on Binance: these are never used as a crypto backup. */
const FX_ONLY_SOURCES = new Set(["CTRADER", "TRADERMADE"]);

/**
 * Provider selection is configuration, not environment: each Instrument row
 * names its primary feed (FX/metals: CTRADER, crypto: BINANCE) and optional
 * backup (FX/metals: TRADERMADE), set on Admin -> Trading Engine. Local
 * development or CI without cTrader credentials sets the FX rows to STUB.
 */
export function effectiveFeedSource(inst: { feedSource: string }, env: FeedEnv = process.env): string {
  void env;
  return inst.feedSource.trim().toUpperCase();
}

/** The backup provider, or null when there is none (blank, same as the primary, or an FX feed on a crypto instrument). */
export function effectiveBackupSource(inst: { feedSource: string; backupFeedSource?: string | null; category?: string | null }, env: FeedEnv = process.env): string | null {
  if (!inst.backupFeedSource || !inst.backupFeedSource.trim()) return null;
  const backup = inst.backupFeedSource.trim().toUpperCase();
  if (inst.category === "CRYPTO" && FX_ONLY_SOURCES.has(backup)) return null;
  return backup === effectiveFeedSource(inst, env) ? null : backup;
}

function feedSymbolFor(source: string, inst: FeedInstrument, backup: boolean): string {
  if (STUB_LIKE.test(source)) return inst.symbol;
  if (backup) return inst.backupFeedSymbol?.trim() || inst.feedSymbol || inst.symbol;
  return inst.feedSymbol || inst.symbol;
}

export function planFeeds(instruments: Iterable<FeedInstrument>, env: FeedEnv = process.env): { routes: FeedRoute[]; groups: Map<string, FeedSymbol[]> } {
  const routes: FeedRoute[] = [];
  const groups = new Map<string, FeedSymbol[]>();
  const add = (source: string, sym: FeedSymbol) => {
    const list = groups.get(source) ?? [];
    list.push(sym);
    groups.set(source, list);
  };
  for (const inst of instruments) {
    const primary = effectiveFeedSource(inst, env);
    const backup = effectiveBackupSource(inst, env);
    routes.push({ symbol: inst.symbol, primary, backup });
    add(primary, { symbol: inst.symbol, feedSymbol: feedSymbolFor(primary, inst, false), digits: inst.digits });
    if (backup) add(backup, { symbol: inst.symbol, feedSymbol: feedSymbolFor(backup, inst, true), digits: inst.digits });
  }
  return { routes, groups };
}

/** Stable identity of a provider's subscription set (restart the provider when it changes). */
export function subscriptionKey(symbols: FeedSymbol[]): string {
  return symbols
    .map((s) => `${s.symbol}=${s.feedSymbol}`)
    .sort()
    .join(",");
}
