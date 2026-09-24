import { requireAdminPage } from "@/lib/auth/pageGuards";
import { workerRequest } from "@/lib/services/settings";
import { prisma } from "@/lib/prisma";
import { EngineControls } from "@/components/admin/EngineControls";
import { StatCard } from "@/components/ui/Card";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Shape of GET /status on the trading worker (src/trading/http.ts). */
type WorkerStatus = {
  feeds?: Record<string, { connected: boolean; lastTickAt: number | null }>;
  symbols?: Record<string, { source: string; lastTickAt: number | null; stale: boolean }>;
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
  };
};

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

      <div className="card !p-0 overflow-hidden">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold">Instruments & feed status</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">Symbol</th>
                <th className="px-4 py-2.5">Category</th>
                <th className="px-4 py-2.5">Feed</th>
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
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted">
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
                    <td className="px-4 py-2.5 text-xs">{feed?.source ?? i.feedSource}</td>
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

      {engine?.lastSweep && (
        <p className="text-xs text-muted">
          Last risk sweep {engine.lastSweep.at ? formatDateTime(new Date(engine.lastSweep.at)) : ""}: {engine.lastSweep.evaluated ?? 0} evaluated, {engine.lastSweep.transitioned ?? 0} transitioned,{" "}
          {engine.lastSweep.errors ?? 0} errors.
        </p>
      )}
    </div>
  );
}
