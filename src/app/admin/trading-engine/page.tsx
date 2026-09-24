import { requireAdminPage } from "@/lib/auth/pageGuards";
import { workerRequest } from "@/lib/services/settings";
import { prisma } from "@/lib/prisma";
import { EngineControls } from "@/components/admin/EngineControls";
import { BackupFeedEditor } from "@/components/admin/BackupFeedEditor";
import { StatCard } from "@/components/ui/Card";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Shape of GET /status on the trading worker (src/trading/http.ts). */
type WorkerStatus = {
  feeds?: Record<string, { connected: boolean; lastTickAt: number | null; paused?: boolean }>;
  /** `source` feeds the engine right now; primary/backup come from the feed router. */
  symbols?: Record<
    string,
    { source: string; lastTickAt: number | null; stale: boolean; primary?: string; backup?: string | null; onBackup?: boolean; primaryLastTickAt?: number | null; backupLastTickAt?: number | null; activeSince?: number }
  >;
  failover?: {
    staleMs: number;
    stableMs: number;
    switches: { symbol: string; from: string; to: string; reason: "PRIMARY_STALE" | "PRIMARY_RECOVERED" | "BACKUP_STALE"; at: number }[];
  } | null;
  connections?: number;
  uptime?: number;
  engine?: {
    marketState?: string | { state: string; reason?: string };
    manualHalt?: boolean;
    instruments?: number;
    trackedAccounts?: number;
    openPositions?: number;
    inflight?: number;
    lagMs?: { samples: number; p50: number; p95: number; max: number };
    fx?: number | null;
    lastSweep?: { at?: string | number; evaluated?: number; transitioned?: number; errors?: number } | null;
    news?: { windowMinutes: number; upcomingHighImpact: number };
  };
};

const SWITCH_REASON: Record<string, string> = {
  PRIMARY_STALE: "primary stale",
  PRIMARY_RECOVERED: "primary recovered",
  BACKUP_STALE: "backup stale",
};

function age(ms: number | null | undefined, now: number): string {
  if (ms == null) return "never";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  return s < 90 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

export default async function AdminTradingEnginePage() {
  await requireAdminPage();
  const [status, instruments, openPositions] = await Promise.all([
    workerRequest<WorkerStatus>("/status"),
    prisma.instrument.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.position.count({ where: { status: "OPEN" } }),
  ]);
  const s = status.data ?? null;
  const engine = s?.engine ?? null;
  const rawState = engine?.marketState ?? null;
  const marketState = rawState == null ? null : typeof rawState === "string" ? rawState : rawState.state;
  const marketReason = rawState && typeof rawState === "object" ? rawState.reason : undefined;
  const now = new Date().getTime(); // render snapshot: the "ago" labels are relative to it
  const onBackup = Object.values(s?.symbols ?? {}).filter((x) => x.onBackup).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-2xl font-semibold">Trading Engine</h1>
          <p className="text-sm text-muted">Price feeds, the simulated execution engine and the live risk engine (the trading worker process).</p>
        </div>
        <EngineControls reachable={status.ok} halted={!!engine?.manualHalt} />
      </div>

      {!status.ok && (
        <div role="alert" className="card border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          The trading worker is not reachable at {process.env.WORKER_INTERNAL_URL ?? "http://localhost:4100"}. Start it with <code>npm run worker</code> (or the
          worker container) and check WORKER_INTERNAL_TOKEN.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Market" value={marketState ?? "—"} sublabel={engine?.manualHalt ? "manual halt" : marketReason} tone={marketState === "OPEN" ? "success" : "danger"} />
        <StatCard label="WS connections" value={s?.connections ?? "—"} />
        <StatCard label="Tracked accounts" value={engine?.trackedAccounts ?? "—"} sublabel={engine?.instruments != null ? `${engine.instruments} instruments` : undefined} />
        <StatCard label="Open positions" value={openPositions} sublabel="database" />
        <StatCard label="Engine lag (p95)" value={engine?.lagMs ? `${engine.lagMs.p95} ms` : "—"} sublabel={engine?.lagMs ? `p50 ${engine.lagMs.p50} ms` : undefined} />
        <StatCard label="Uptime" value={s?.uptime != null ? `${Math.floor(s.uptime / 60)} min` : "—"} sublabel={engine?.fx ? `USD/ETB ${engine.fx}` : undefined} />
      </div>

      {onBackup > 0 && (
        <div role="alert" className="card border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          {onBackup} instrument{onBackup === 1 ? " is" : "s are"} running on the backup feed. The primary returns automatically after{" "}
          {Math.round((s?.failover?.stableMs ?? 30_000) / 1000)} s of continuous health.
        </div>
      )}

      <div className="card !p-0 overflow-hidden">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold">Instruments & feed status</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">Symbol</th>
                <th className="px-4 py-2.5">Category</th>
                <th className="px-4 py-2.5">Active feed</th>
                <th className="px-4 py-2.5">Primary</th>
                <th className="px-4 py-2.5">Backup</th>
                <th className="px-4 py-2.5">Last tick</th>
                <th className="px-4 py-2.5">Contract</th>
                <th className="px-4 py-2.5">Markup (pts)</th>
                <th className="px-4 py-2.5">Commission / lot</th>
                <th className="px-4 py-2.5">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {instruments.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-muted">
                    No instruments configured. Run the worker with SEED_DEFAULT_INSTRUMENTS=true or seed the database.
                  </td>
                </tr>
              )}
              {instruments.map((i) => {
                const feed = s?.symbols?.[i.symbol];
                const last = feed?.lastTickAt ? new Date(feed.lastTickAt) : null;
                const stale = feed?.stale ?? !last;
                return (
                  <tr key={i.symbol} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 font-medium">{i.symbol}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{i.category}</td>
                    <td className="px-4 py-2.5 text-xs">
                      <span className={feed?.onBackup ? "font-semibold text-warning" : ""}>{feed?.source ?? i.feedSource}</span>
                      {feed?.onBackup && <span className="ml-1 rounded bg-warning/15 px-1 text-[10px] uppercase text-warning">backup</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <div>{feed?.primary ?? i.feedSource}</div>
                      {feed?.primary && <div className="text-[10px] text-muted">{age(feed.primaryLastTickAt, now)}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <div className="flex items-center gap-1">
                        <span>{i.backupFeedSource ? `${i.backupFeedSource}${i.backupFeedSymbol ? ` · ${i.backupFeedSymbol}` : ""}` : "—"}</span>
                        <BackupFeedEditor symbol={i.symbol} primary={i.feedSource} backupSource={i.backupFeedSource} backupSymbol={i.backupFeedSymbol} />
                      </div>
                      {feed?.backup && <div className="text-[10px] text-muted">{feed.backup !== i.backupFeedSource ? `effective ${feed.backup} · ` : ""}{age(feed.backupLastTickAt, now)}</div>}
                      {i.backupFeedSource && feed && !feed.backup && <div className="text-[10px] text-muted">inactive (FEED_SOURCES_OVERRIDE)</div>}
                    </td>
                    <td className={`px-4 py-2.5 text-xs ${stale ? "text-danger" : "text-success"}`}>{last ? formatDateTime(last) : "no data"}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{i.contractSize}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{i.spreadMarkupPoints}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">{i.commissionPerLot}</td>
                    <td className="px-4 py-2.5 text-xs">{i.enabled ? "yes" : "no"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <span className="text-sm font-semibold">Recent feed switches</span>
          {s?.failover && (
            <span className="text-xs text-muted">
              failover after {s.failover.staleMs / 1000}s silence · failback after {s.failover.stableMs / 1000}s stable
            </span>
          )}
        </div>
        {s?.failover?.switches?.length ? (
          <ul className="divide-y divide-border/60 text-sm">
            {s.failover.switches.map((ev) => (
              <li key={`${ev.symbol}-${ev.at}-${ev.to}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2">
                <span className="w-40 text-xs text-muted">{formatDateTime(new Date(ev.at))}</span>
                <span className="font-medium">{ev.symbol}</span>
                <span className="font-mono text-xs">
                  {ev.from} → {ev.to}
                </span>
                <span className={`text-xs ${ev.reason === "PRIMARY_RECOVERED" ? "text-success" : "text-warning"}`}>{SWITCH_REASON[ev.reason] ?? ev.reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-sm text-muted">No switches since the worker started.</p>
        )}
      </div>

      {engine?.news && (
        <p className="text-xs text-muted">
          News rule: ±{engine.news.windowMinutes} min around {engine.news.upcomingHighImpact} upcoming high-impact event(s) (see News Calendar).
        </p>
      )}

      {engine?.lastSweep && (
        <p className="text-xs text-muted">
          Last risk sweep {engine.lastSweep.at ? formatDateTime(new Date(engine.lastSweep.at)) : ""}: {engine.lastSweep.evaluated ?? 0} evaluated, {engine.lastSweep.transitioned ?? 0} transitioned,{" "}
          {engine.lastSweep.errors ?? 0} errors.
        </p>
      )}
    </div>
  );
}
