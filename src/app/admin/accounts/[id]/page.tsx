import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdminPage } from "@/lib/auth/pageGuards";
import { refreshAccount } from "@/lib/services/accounts";
import { buildEquityCurveFromDb, computeAccountMetricsFromDb } from "@/lib/services/accountMetrics";
import { dailyLossFloor, maxDrawdownFloor } from "@/lib/services/challengeRules";
import { StatCard } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { EquityCurveChart } from "@/components/ui/Charts";
import { formatCurrency, formatDateTime, formatPercent, formatSigned } from "@/lib/format";
import { AccountAdminActions } from "@/components/admin/AccountAdminActions";
import { devOverridesEnabled } from "@/env";
import type { TemplateSnapshot } from "@/types";

export const dynamic = "force-dynamic";

export default async function AdminAccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [, { id }] = await Promise.all([requireAdminPage(), params]);
  const account = await refreshAccount(id);
  if (!account) notFound();

  const [metrics, curve] = await Promise.all([computeAccountMetricsFromDb(account), buildEquityCurveFromDb(account.id, account.startingBalance)]);
  const snapshot = account.snapshot as unknown as TemplateSnapshot;
  const currency = snapshot.accountCurrency || "ETB";
  const ddFloor = maxDrawdownFloor({ startingBalance: account.startingBalance, highWaterMark: account.highWaterMark, maxDrawdownPercent: snapshot.maxDrawdown, mode: snapshot.drawdownMode });
  const dlFloor = dailyLossFloor({ dailyAnchorBalance: account.dailyAnchorBalance, dailyDrawdownPercent: snapshot.dailyDrawdown });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <Link href="/admin/accounts" className="text-xs text-muted hover:text-foreground">
            ← Back to Accounts
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{snapshot.name ?? account.template?.name ?? "Trading Account"}</h1>
          <p className="text-sm text-muted">
            <Link href={`/admin/users/${account.user.id}`} className="hover:underline">
              {account.user.name}
            </Link>{" "}
            ({account.user.email}) · <span className="font-mono">{account.id}</span>
          </p>
          {account.failureReason && <p className="mt-1 text-xs text-danger">Reason: {account.failureReason}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={account.status} />
          <AccountAdminActions accountId={account.id} currentStatus={account.status} phase={account.phase} devOverrides={devOverridesEnabled()} hasNextAccount={false} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Starting Balance" value={formatCurrency(account.startingBalance, currency)} />
        <StatCard label="Balance" value={formatCurrency(account.balance, currency)} />
        <StatCard label="Equity" value={formatCurrency(account.equity, currency)} />
        <StatCard label="Net P&L" value={formatSigned(metrics.netPnl, currency)} tone={metrics.netPnl >= 0 ? "success" : "danger"} />
        <StatCard label="Daily loss floor" value={formatCurrency(dlFloor, currency)} sublabel={`anchor ${formatCurrency(account.dailyAnchorBalance, currency)}`} />
        <StatCard label="Max loss floor" value={formatCurrency(ddFloor, currency)} sublabel={`HWM ${formatCurrency(account.highWaterMark, currency)}`} />
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold">Equity Curve</h3>
        {curve.length > 1 ? <EquityCurveChart data={curve} currency={currency} /> : <div className="flex h-40 items-center justify-center text-sm text-muted">No closed trades yet.</div>}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold">Challenge Configuration (Purchased Snapshot)</h3>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <RuleRow label="Phase" value={snapshot.phase.replace("_", " ")} />
            <RuleRow label="Profit Target" value={snapshot.profitTarget != null ? `${snapshot.profitTarget}%` : "—"} />
            <RuleRow label="Profit Split" value={`${snapshot.profitSplit}%`} />
            <RuleRow label="Max Loss" value={`${snapshot.maxDrawdown}% (${snapshot.drawdownMode === "TRAILING" ? "trailing" : "static"})`} />
            <RuleRow label="Daily Loss" value={`${snapshot.dailyDrawdown}% · resets ${snapshot.dailyLossResetTime}`} />
            <RuleRow label="Min Trading Days" value={String(snapshot.minTradingDays)} />
            <RuleRow label="Leverage" value={`1:${snapshot.leverage}`} />
            <RuleRow label="Duration" value={snapshot.durationDays ? `${snapshot.durationDays} days` : "Unlimited"} />
            <RuleRow label="Expires" value={account.expiresAt ? formatDateTime(account.expiresAt) : "—"} />
            <RuleRow label="Purchase" value={account.purchase ? `${account.purchase.status} · ${formatCurrency(account.purchase.amount, account.purchase.currency)}` : "Admin-created"} />
          </dl>
        </div>

        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold">Performance Detail</h3>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <RuleRow label="Trades (closed / open)" value={`${metrics.closedTrades} / ${metrics.openTrades + account.positions.length}`} />
            <RuleRow label="Winning / Losing" value={`${metrics.winningTrades} / ${metrics.losingTrades}`} />
            <RuleRow label="Win rate" value={formatPercent(metrics.winRate)} />
            <RuleRow label="Profit Factor" value={metrics.profitFactor != null ? metrics.profitFactor.toFixed(2) : "—"} />
            <RuleRow label="Avg Win / Loss" value={`${formatCurrency(metrics.avgWin, currency)} / ${formatCurrency(metrics.avgLoss, currency)}`} />
            <RuleRow label="Largest Win / Loss" value={`${formatCurrency(metrics.largestWin, currency)} / ${formatCurrency(metrics.largestLoss, currency)}`} />
            <RuleRow label="Trading days" value={String(metrics.tradingDays)} />
            <RuleRow label="Margin used" value={formatCurrency(account.marginUsed, currency)} />
            <RuleRow label="Created" value={formatDateTime(account.createdAt)} />
            <RuleRow label="Last Updated" value={formatDateTime(account.updatedAt)} />
          </dl>
        </div>
      </div>

      {account.positions.length > 0 && (
        <div className="card !p-0 overflow-hidden">
          <div className="border-b border-border px-5 py-3 text-sm font-semibold">Open Positions</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5">Symbol</th>
                  <th className="px-4 py-2.5">Side</th>
                  <th className="px-4 py-2.5">Volume</th>
                  <th className="px-4 py-2.5">Entry</th>
                  <th className="px-4 py-2.5">Current</th>
                  <th className="px-4 py-2.5">Floating</th>
                  <th className="px-4 py-2.5">SL / TP</th>
                  <th className="px-4 py-2.5">Opened</th>
                </tr>
              </thead>
              <tbody>
                {account.positions.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 font-medium">{p.symbol}</td>
                    <td className="px-4 py-2.5">{p.side}</td>
                    <td className="px-4 py-2.5">{p.volume}</td>
                    <td className="px-4 py-2.5">{p.entryPrice}</td>
                    <td className="px-4 py-2.5">{p.currentPrice ?? "—"}</td>
                    <td className={`px-4 py-2.5 ${p.floatingPnl >= 0 ? "text-success" : "text-danger"}`}>{formatSigned(p.floatingPnl, currency)}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">
                      {p.stopLoss ?? "—"} / {p.takeProfit ?? "—"}
                    </td>
                    <td className="px-4 py-2.5">{formatDateTime(p.openedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card !p-0 overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold">Recent Trades (last {account.trades.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">Symbol</th>
                <th className="px-4 py-2.5">Side</th>
                <th className="px-4 py-2.5">Volume</th>
                <th className="px-4 py-2.5">Entry</th>
                <th className="px-4 py-2.5">Exit</th>
                <th className="px-4 py-2.5">Net P&L</th>
                <th className="px-4 py-2.5">Reason</th>
                <th className="px-4 py-2.5">Source</th>
                <th className="px-4 py-2.5">Opened</th>
              </tr>
            </thead>
            <tbody>
              {account.trades.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-muted">
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
                  <td className={`px-4 py-2.5 ${t.netProfit >= 0 ? "text-success" : "text-danger"}`}>{formatSigned(t.netProfit, currency)}</td>
                  <td className="px-4 py-2.5 text-xs text-muted">{t.closeReason ?? t.status}</td>
                  <td className="px-4 py-2.5 text-xs text-muted">{t.feedSource ?? "—"}</td>
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
