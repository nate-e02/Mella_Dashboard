import type { Tick } from "@/trading/protocol";

/**
 * Per-symbol primary/backup feed selection. Every provider tick is offered
 * to the router tagged with the provider source it came from; only ticks from
 * the symbol's *active* source are forwarded, so the engine, candles and
 * clients always see exactly one price stream per symbol.
 *
 * Failover: the primary has been silent for `staleMs` while the backup ticked
 * within `staleMs` -> switch to the backup (forwarding the backup's latest
 * tick right away so there is no gap).
 * Failback (hysteresis): the primary has been ticking without a gap longer
 * than `staleMs` for `stableMs` -> switch back. A flapping primary keeps
 * restarting that clock, so it never steals the stream back while unstable.
 * If the backup itself goes silent while the primary is fresh again, the
 * router returns to the primary immediately. When both are silent nothing
 * switches; the engine's own staleness guard halts the symbol.
 *
 * Pure logic with an injectable clock: the worker calls `evaluate()` on a
 * short timer (a silent primary produces no ticks to react to), tests drive
 * it with a fake clock.
 */

export type FeedRoute = { symbol: string; primary: string; backup: string | null };

export type FeedSwitchReason = "PRIMARY_STALE" | "PRIMARY_RECOVERED" | "BACKUP_STALE";

export type FeedSwitchEvent = {
  symbol: string;
  from: string;
  to: string;
  reason: FeedSwitchReason;
  at: number;
  primaryLastTickAt: number | null;
  backupLastTickAt: number | null;
};

export type FeedSymbolState = {
  primary: string;
  backup: string | null;
  active: string;
  onBackup: boolean;
  primaryLastTickAt: number | null;
  backupLastTickAt: number | null;
  /** Start of the primary's current gap-free run (null while it is silent). */
  primaryHealthySince: number | null;
  activeSince: number;
  switches: number;
};

export type FeedRouterOptions = {
  now?: () => number;
  /** Primary silence that triggers a failover (FEED_FAILOVER_STALE_MS). */
  staleMs?: number;
  /** Continuous primary health required before failing back (FEED_FAILBACK_STABLE_MS). */
  stableMs?: number;
  /** Switch events kept for /status. */
  historySize?: number;
};

export const DEFAULT_FAILOVER_STALE_MS = 3_000;
export const DEFAULT_FAILBACK_STABLE_MS = 30_000;

type SymbolState = {
  route: FeedRoute;
  active: string;
  activeSince: number;
  /** When the route was (re)configured: a primary that never ticked is measured from here. */
  since: number;
  last: Map<string, { at: number; tick: Tick }>;
  primaryHealthySince: number | null;
  switches: number;
};

export class FeedRouter {
  readonly staleMs: number;
  readonly stableMs: number;
  private readonly now: () => number;
  private readonly historySize: number;
  private symbols = new Map<string, SymbolState>();
  private tickListeners: ((t: Tick) => void)[] = [];
  private switchListeners: ((e: FeedSwitchEvent) => void)[] = [];
  private history: FeedSwitchEvent[] = [];

  constructor(opts: FeedRouterOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.staleMs = positive(opts.staleMs, DEFAULT_FAILOVER_STALE_MS);
    this.stableMs = positive(opts.stableMs, DEFAULT_FAILBACK_STABLE_MS);
    this.historySize = opts.historySize ?? 50;
  }

  onTick(cb: (t: Tick) => void): void {
    this.tickListeners.push(cb);
  }

  onSwitch(cb: (e: FeedSwitchEvent) => void): void {
    this.switchListeners.push(cb);
  }

  /**
   * Installs the current routing table. Symbols whose primary/backup did not
   * change keep their state (including an active failover); a changed route
   * starts over on its primary; symbols no longer listed are dropped.
   */
  setRoutes(routes: FeedRoute[]): void {
    const now = this.now();
    const seen = new Set<string>();
    for (const r of routes) {
      const route: FeedRoute = { symbol: r.symbol, primary: r.primary, backup: r.backup && r.backup !== r.primary ? r.backup : null };
      seen.add(route.symbol);
      const existing = this.symbols.get(route.symbol);
      if (existing && existing.route.primary === route.primary && existing.route.backup === route.backup) continue;
      const last = new Map<string, { at: number; tick: Tick }>();
      if (existing) for (const [src, v] of existing.last) if (src === route.primary || src === route.backup) last.set(src, v);
      const primaryLast = last.get(route.primary)?.at ?? null;
      this.symbols.set(route.symbol, {
        route,
        active: route.primary,
        activeSince: now,
        since: now,
        last,
        primaryHealthySince: primaryLast != null && now - primaryLast <= this.staleMs ? primaryLast : null,
        switches: existing?.switches ?? 0,
      });
    }
    for (const s of Array.from(this.symbols.keys())) if (!seen.has(s)) this.symbols.delete(s);
  }

  /** Offers a provider tick. Returns true when it was forwarded (it came from the active source). */
  ingest(source: string, tick: Tick): boolean {
    const st = this.symbols.get(tick.symbol);
    if (!st) return false;
    if (source !== st.route.primary && source !== st.route.backup) return false;
    const now = this.now();
    if (source === st.route.primary) {
      const prev = st.last.get(source)?.at ?? null;
      if (prev == null || now - prev > this.staleMs || st.primaryHealthySince == null) st.primaryHealthySince = now;
    }
    st.last.set(source, { at: now, tick });
    const before = st.active;
    this.evaluateSymbol(st, now);
    if (source !== st.active) return false;
    // A switch onto this source already handed this very tick over.
    if (st.active !== before) return true;
    this.forward(tick);
    return true;
  }

  /** Re-checks every symbol against the clock (a silent primary sends no ticks to react to). */
  evaluate(): void {
    const now = this.now();
    for (const st of this.symbols.values()) this.evaluateSymbol(st, now);
  }

  activeSource(symbol: string): string | null {
    return this.symbols.get(symbol)?.active ?? null;
  }

  state(): Record<string, FeedSymbolState> {
    const out: Record<string, FeedSymbolState> = {};
    for (const [symbol, st] of this.symbols) {
      out[symbol] = {
        primary: st.route.primary,
        backup: st.route.backup,
        active: st.active,
        onBackup: st.active !== st.route.primary,
        primaryLastTickAt: st.last.get(st.route.primary)?.at ?? null,
        backupLastTickAt: st.route.backup ? (st.last.get(st.route.backup)?.at ?? null) : null,
        primaryHealthySince: st.primaryHealthySince,
        activeSince: st.activeSince,
        switches: st.switches,
      };
    }
    return out;
  }

  /** Most recent switches, newest first. */
  recentSwitches(): FeedSwitchEvent[] {
    return [...this.history].reverse();
  }

  // -- internals -----------------------------------------------------------

  private evaluateSymbol(st: SymbolState, now: number) {
    const { primary, backup } = st.route;
    if (!backup) return;
    const primaryAt = st.last.get(primary)?.at ?? null;
    const backupAt = st.last.get(backup)?.at ?? null;
    const primaryFresh = primaryAt != null && now - primaryAt <= this.staleMs;
    const backupFresh = backupAt != null && now - backupAt <= this.staleMs;
    if (!primaryFresh) st.primaryHealthySince = null;

    if (st.active === primary) {
      const silentFor = now - (primaryAt ?? st.since);
      if (silentFor > this.staleMs && backupFresh) this.switchTo(st, backup, "PRIMARY_STALE", now);
      return;
    }
    // On the backup.
    if (primaryFresh && st.primaryHealthySince != null && now - st.primaryHealthySince >= this.stableMs) {
      this.switchTo(st, primary, "PRIMARY_RECOVERED", now);
    } else if (primaryFresh && !backupFresh) {
      this.switchTo(st, primary, "BACKUP_STALE", now);
    }
  }

  private switchTo(st: SymbolState, to: string, reason: FeedSwitchReason, now: number) {
    const from = st.active;
    st.active = to;
    st.activeSince = now;
    st.switches += 1;
    const ev: FeedSwitchEvent = {
      symbol: st.route.symbol,
      from,
      to,
      reason,
      at: now,
      primaryLastTickAt: st.last.get(st.route.primary)?.at ?? null,
      backupLastTickAt: st.route.backup ? (st.last.get(st.route.backup)?.at ?? null) : null,
    };
    this.history.push(ev);
    if (this.history.length > this.historySize) this.history.shift();
    for (const cb of this.switchListeners) {
      try {
        cb(ev);
      } catch {
        // a listener error must never stop routing
      }
    }
    // Hand the new source's latest (fresh) price over immediately so the engine sees no gap.
    const latest = st.last.get(to);
    if (latest && now - latest.at <= this.staleMs) this.forward(latest.tick);
  }

  private forward(tick: Tick) {
    for (const cb of this.tickListeners) {
      try {
        cb(tick);
      } catch {
        // listener errors are the listener's problem (the worker logs them)
      }
    }
  }
}

function positive(v: number | undefined, fallback: number): number {
  return v != null && Number.isFinite(v) && v > 0 ? v : fallback;
}
