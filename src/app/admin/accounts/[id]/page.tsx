import { notFound } from "next/navigation";
import Link from "next/link";
import { getAccountById } from "@/lib/services/accounts";
import { computeAccountMetrics, buildEquityCurve } from "@/lib/services/calculations";
import { StatCard } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { EquityCurveChart } from "@/components/ui/Charts";
import { formatCurrency, formatDateTime, formatPercent } from "@/lib/format";
import { AccountAdminActions } from "@/components/admin/AccountAdminActions";
import type { TemplateSnapshot } from "@/types";

export const dynamic = "force-dynamic";

export default async function AdminAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const account = await getAccountById(id);
  if (!account) notFound();

  const metrics = computeAccountMetrics(account.startingBalance, account.trades);
  const equityCurve = buildEquityCurve(account.startingBalance, account.trades).map((p) => ({ date: p.date, equity: p.equity }));
  const snapshot = account.snapshot as unknown as TemplateSnapshot;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <Link href="/admin/accounts" className="text-xs text-muted hover:text-foreground">
            ← Back to Accounts
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{account.template?.name ?? "Trading Account"}</h1>
          <p className="text-sm text-muted">
            {account.user.name} ({account.user.email}) · <span className="font-mono">{account.id}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={account.status} />
          <AccountAdminActions accountId={account.id} currentStatus={account.status} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Starting Balance" value={formatCurrency(account.startingBalance)} />
        <StatCard label="Balance" value={formatCurrency(account.balance)} />
        <StatCard label="Equity" value={formatCurrency(account.equity)} />
        <StatCard label="Net P&L" value={formatCurrency(metrics.netPnl)} tone={metrics.netPnl >= 0 ? "success" : "danger"} />
        <StatCard label="Win Rate" value={formatPercent(metrics.winRate)} />
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold">Equity Curve</h3>
        {equityCurve.length > 1 ? (
          <EquityCurveChart data={equityCurve} />
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-muted">No closed trades yet.</div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold">Challenge Configuration (Purchased Snapshot)</h3>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <RuleRow label="Phase" value={snapshot.phase.replace("_", " ")} />
            <RuleRow label="Profit Target" value={snapshot.profitTarget != null ? `${snapshot.profitTarget}%` : "—"} />
            <RuleRow label="Profit Split" value={`${snapshot.profitSplit}%`} />
            <RuleRow label="Max Drawdown" value={`${snapshot.maxDrawdown}%`} />
            <RuleRow label="Daily Drawdown" value={`${snapshot.dailyDrawdown}%`} />
            <RuleRow label="Min Trading Days" value={String(snapshot.minTradingDays)} />
            <RuleRow label="Leverage" value={`1:${snapshot.leverage}`} />
            <RuleRow label="Duration" value={snapshot.durationDays ? `${snapshot.durationDays} days` : "Unlimited"} />
          </dl>
        </div>

        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold">Performance Detail</h3>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <RuleRow label="Trades" value={String(metrics.totalTrades)} />
            <RuleRow label="Winning / Losing" value={`${metrics.winningTrades} / ${metrics.losingTrades}`} />
            <RuleRow label="Profit Factor" value={metrics.profitFactor != null ? metrics.profitFactor.toFixed(2) : "—"} />
            <RuleRow label="Avg Win / Loss" value={`${formatCurrency(metrics.avgWin)} / ${formatCurrency(metrics.avgLoss)}`} />
            <RuleRow label="Largest Win / Loss" value={`${formatCurrency(metrics.largestWin)} / ${formatCurrency(metrics.largestLoss)}`} />
            <RuleRow label="Created" value={formatDateTime(account.createdAt)} />
            <RuleRow label="Last Updated" value={formatDateTime(account.updatedAt)} />
          </dl>
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold">Trade History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">Symbol</th>
                <th className="px-4 py-2.5">Side</th>
                <th className="px-4 py-2.5">Volume</th>
                <th className="px-4 py-2.5">Entry</th>
                <th className="px-4 py-2.5">Exit</th>
                <th className="px-4 py-2.5">Net P&L</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Opened</th>
              </tr>
            </thead>
            <tbody>
              {account.trades.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted">
                    No trades for this account.
                  </td>
                </tr>
              )}
              {account.trades.map((t) => (
                <tr key={t.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 font-medium">{t.symbol}</td>
                  <td className="px-4 py-2.5">{t.side}</td>
                  <td className="px-4 py-2.5">{t.volume}</td>
                  <td className="px-4 py-2.5">{t.entryPrice}</td>
                  <td className="px-4 py-2.5">{t.exitPrice ?? "—"}</td>
                  <td className={`px-4 py-2.5 ${t.netProfit >= 0 ? "text-success" : "text-danger"}`}>{formatCurrency(t.netProfit)}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-2.5">{formatDateTime(t.openTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RuleRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </>
  );
}
