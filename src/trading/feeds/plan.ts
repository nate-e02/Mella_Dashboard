import type { FeedRoute } from "./router";
import type { FeedSymbol } from "./types";

/**
 * Which provider serves which instrument, as primary and as backup. A
 * provider may be the primary for some symbols and the backup for others;
 * the worker starts one provider per source in the union and the FeedRouter
 * decides which of a symbol's two streams reaches the engine.
 */

export type FeedEnv = Record<string, string | undefined>;

export type FeedInstrument = { symbol: string; feedSource: string; feedSymbol: string; backupFeedSource?: string | null; backupFeedSymbol?: string | null; digits: number };

const STUB_LIKE = /^STUB\d*$/;

function mapSource(source: string, env: FeedEnv): string {
  const src = source.toUpperCase();
  const override = (env.FEED_SOURCES_OVERRIDE ?? "").toUpperCase();
  if (override === "STUB") {
    // Local development: everything simulated, except that Binance (public,
    // keyless) may stay live and extra stub instances keep their identity so
    // a STUB -> STUB2 failover can be exercised.
    if (src === "BINANCE" && env.ALLOW_BINANCE === "true") return "BINANCE";
    if (STUB_LIKE.test(src)) return src;
    return "STUB";
  }
  if (override) return override;
  return src;
}

/** Which provider actually serves an instrument, honouring the local-dev override. */
export function effectiveFeedSource(inst: { feedSource: string }, env: FeedEnv = process.env): string {
  return mapSource(inst.feedSource, env);
}

/** The backup provider after the override, or null when there is none (or it collapses onto the primary). */
export function effectiveBackupSource(inst: { feedSource: string; backupFeedSource?: string | null }, env: FeedEnv = process.env): string | null {
  if (!inst.backupFeedSource || !inst.backupFeedSource.trim()) return null;
  const backup = mapSource(inst.backupFeedSource.trim(), env);
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
