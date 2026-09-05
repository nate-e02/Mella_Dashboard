import { notFound } from "next/navigation";
import Link from "next/link";
import { requireTrader } from "@/lib/auth/guards";
import { getAccountById } from "@/lib/services/accounts";
import { computeAccountMetrics, buildEquityCurve } from "@/lib/services/calculations";
import { StatCard } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { EquityCurveChart } from "@/components/ui/Charts";
import { formatCurrency, formatPercent } from "@/lib/format";
import type { TemplateSnapshot } from "@/types";

export const dynamic = "force-dynamic";

export default async function TraderAccountAnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireTrader();
  const { id } = await params;
  const account = await getAccountById(id);
  if (!account || account.userId !== user.id) notFound();

  const metrics = computeAccountMetrics(account.startingBalance, account.trades);
  const equityCurve = buildEquityCurve(account.startingBalance, account.trades).map((p) => ({ date: p.date, equity: p.equity }));
  const snapshot = account.snapshot as unknown as TemplateSnapshot;
  const hasTrades = account.trades.length > 0;

  const targetAmount = snapshot.profitTarget ? account.startingBalance * (snapshot.profitTarget / 100) : null;
  const progress = targetAmount ? Math.min(100, Math.max(0, (metrics.netPnl / targetAmount) * 100)) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/purchases" className="text-xs text-muted hover:text-foreground">
          ← Back to My Purchases
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{account.template?.name ?? "Trading Account"}</h1>
          <StatusBadge status={account.status} />
        </div>
      </div>

      {progress !== null && (
        <div className="card p-4">
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>Profit target progress</span>
            <span>{formatPercent(progress, 0)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-gradient-to-r from-accent-2 to-accent" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Current Balance" value={formatCurrency(account.balance)} />
        <StatCard label="Current Equity" value={formatCurrency(account.equity)} />
        <StatCard label="Net P&L" value={formatCurrency(metrics.netPnl)} tone={metrics.netPnl >= 0 ? "success" : "danger"} />
        <StatCard label="Win Rate" value={hasTrades ? formatPercent(metrics.winRate) : "—"} />
        <StatCard label="Profit Factor" value={metrics.profitFactor != null ? metrics.profitFactor.toFixed(2) : "—"} />
        <StatCard label="Total Trades" value={metrics.totalTrades} />
        <StatCard label="Avg Win" value={formatCurrency(metrics.avgWin)} tone="success" />
        <StatCard label="Avg Loss" value={formatCurrency(-metrics.avgLoss)} tone="danger" />
        <StatCard label="Largest Win" value={formatCurrency(metrics.largestWin)} tone="success" />
        <StatCard label="Largest Loss" value={formatCurrency(metrics.largestLoss)} tone="danger" />
        <StatCard label="Total Volume" value={metrics.totalVolume.toFixed(2)} />
        <StatCard label="Trading Days" value={metrics.tradingDays} />
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold">Equity Curve</h3>
        {equityCurve.length > 1 ? (
          <EquityCurveChart data={equityCurve} />
        ) : (
          <div className="flex h-48 flex-col items-center justify-center text-center">
            <div className="text-sm font-medium">No trades yet</div>
            <div className="mt-1 text-xs text-muted">Your equity curve will appear here once trades are recorded on this account.</div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold">Win / Loss Breakdown</h3>
          {hasTrades ? (
            <div className="flex items-center gap-4">
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-danger/30">
                <div className="h-full bg-success" style={{ width: `${metrics.winRate}%` }} />
              </div>
              <span className="text-xs text-muted">
                {metrics.winningTrades}W / {metrics.losingTrades}L
              </span>
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-muted">No closed trades to analyze yet.</div>
          )}
        </div>
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold">Challenge Rules</h3>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted">Max Drawdown</dt>
            <dd className="text-right font-medium">{formatPercent(snapshot.maxDrawdown)}</dd>
            <dt className="text-muted">Daily Drawdown</dt>
            <dd className="text-right font-medium">{formatPercent(snapshot.dailyDrawdown)}</dd>
            <dt className="text-muted">Min Trading Days</dt>
            <dd className="text-right font-medium">{snapshot.minTradingDays}</dd>
            <dt className="text-muted">Profit Split</dt>
            <dd className="text-right font-medium">{formatPercent(snapshot.profitSplit)}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}
