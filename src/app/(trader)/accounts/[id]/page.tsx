import { notFound } from "next/navigation";
import Link from "next/link";
import { requireTraderPage } from "@/lib/auth/pageGuards";
import { prisma } from "@/lib/prisma";
import { refreshAccount } from "@/lib/services/accounts";
import { buildEquityCurveFromDb, computeAccountMetricsFromDb } from "@/lib/services/accountMetrics";
import { dailyLossFloor, maxDrawdownFloor } from "@/lib/services/challengeRules";
import { StatCard } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { EquityCurveChart } from "@/components/ui/Charts";
import { formatCurrency, formatDateTime, formatPercent, formatSigned } from "@/lib/format";
import type { TemplateSnapshot } from "@/types";

export const dynamic = "force-dynamic";

export default async function TraderAccountAnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, { id }] = await Promise.all([requireTraderPage(), params]);

  // Ownership is checked BEFORE any evaluation runs, so a trader cannot
  // trigger writes on someone else's account by guessing an id.
  const owner = await prisma.tradingAccount.findUnique({ where: { id }, select: { userId: true } });
  if (!owner || owner.userId !== user.id) notFound();

  const account = await refreshAccount(id);
  if (!account) notFound();

  const [metrics, curve] = await Promise.all([computeAccountMetricsFromDb(account), buildEquityCurveFromDb(account.id, account.startingBalance)]);
  const snapshot = account.snapshot as unknown as TemplateSnapshot;
  const currency = snapshot.accountCurrency || "ETB";
  const hasTrades = metrics.totalTrades > 0 || account.positions.length > 0;

  const targetAmount = snapshot.profitTarget ? account.startingBalance * (snapshot.profitTarget / 100) : null;
  const progress = targetAmount ? Math.min(100, Math.max(0, (metrics.netPnl / targetAmount) * 100)) : null;
  const ddFloor = maxDrawdownFloor({ startingBalance: account.startingBalance, highWaterMark: account.highWaterMark, maxDrawdownPercent: snapshot.maxDrawdown, mode: snapshot.drawdownMode });
  const dlFloor = dailyLossFloor({ dailyAnchorBalance: account.dailyAnchorBalance, dailyDrawdownPercent: snapshot.dailyDrawdown });
  const dailyLimit = account.dailyAnchorBalance * (snapshot.dailyDrawdown / 100);
  const dailyUsed = Math.max(0, account.dailyAnchorBalance - account.equity);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/dashboard" className="text-xs text-muted hover:text-foreground">
          ← Back to Dashboard
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{snapshot.name ?? account.template?.name ?? "Trading Account"}</h1>
          <StatusBadge status={account.status} />
          {account.failureReason && <span className="text-xs text-danger">{account.failureReason.replace(/_/g, " ").toLowerCase()}</span>}
        </div>
        <p className="text-xs text-muted">
          {account.phase.replace("_", " ")} · started {formatDateTime(account.createdAt)}
          {account.expiresAt ? ` · ends ${formatDateTime(account.expiresAt)}` : ""}
        </p>
      </div>

      {progress !== null && (
        <div className="card p-4">
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>
              Profit target progress ({formatCurrency(metrics.netPnl, currency)} of {formatCurrency(targetAmount!, currency)})
            </span>
            <span>{formatPercent(progress, 0)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-gradient-to-r from-accent-2 to-accent" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Balance" value={formatCurrency(account.balance, currency)} />
        <StatCard label="Equity" value={formatCurrency(account.equity, currency)} />
        <StatCard label="Net P&L" value={formatSigned(metrics.netPnl, currency)} tone={metrics.netPnl >= 0 ? "success" : "danger"} />
        <StatCard label="Floating P&L" value={formatSigned(metrics.unrealizedPnl, currency)} tone={metrics.unrealizedPnl >= 0 ? "success" : "danger"} />
        <StatCard
          label="Daily loss used"
          value={`${formatCurrency(dailyUsed, currency)} / ${formatCurrency(dailyLimit, currency)}`}
          sublabel={`Fails at ${formatCurrency(dlFloor, currency)} equity`}
          tone={dailyUsed > dailyLimit * 0.8 ? "danger" : "default"}
        />
        <StatCard
          label="Max loss remaining"
          value={formatCurrency(Math.max(0, account.equity - ddFloor), currency)}
          sublabel={`${snapshot.drawdownMode === "TRAILING" ? "Trailing" : "Static"} floor ${formatCurrency(ddFloor, currency)}`}
        />
        <StatCard label="Win Rate" value={hasTrades ? formatPercent(metrics.winRate) : "—"} />
        <StatCard label="Profit Factor" value={metrics.profitFactor != null ? metrics.profitFactor.toFixed(2) : "—"} />
        <StatCard label="Trades" value={metrics.totalTrades} />
        <StatCard label="Avg Win / Loss" value={`${formatCurrency(metrics.avgWin, currency)} / ${formatCurrency(-metrics.avgLoss, currency)}`} />
        <StatCard label="Largest Win / Loss" value={`${formatCurrency(metrics.largestWin, currency)} / ${formatCurrency(metrics.largestLoss, currency)}`} />
        <StatCard label="Trading Days" value={`${metrics.tradingDays} / ${snapshot.minTradingDays} min`} />
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold">Equity Curve</h3>
        {curve.length > 1 ? (
          <EquityCurveChart data={curve} currency={currency} />
        ) : (
          <div className="flex h-48 flex-col items-center justify-center text-center">
            <div className="text-sm font-medium">No closed trades yet</div>
            <div className="mt-1 text-xs text-muted">Your equity curve will appear here once trades are closed on this account.</div>
          </div>
        )}
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
                  <th className="px-4 py-2.5">Floating P&L</th>
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
                    <td className="px-4 py-2.5">{formatDateTime(p.openedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold">Win / Loss Breakdown</h3>
          {metrics.closedTrades > 0 ? (
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
            <Row label="Profit target" value={snapshot.profitTarget != null ? formatPercent(snapshot.profitTarget, 0) : "—"} />
            <Row label="Max loss" value={`${formatPercent(snapshot.maxDrawdown, 0)} (${snapshot.drawdownMode === "TRAILING" ? "trailing" : "static"})`} />
            <Row label="Daily loss" value={`${formatPercent(snapshot.dailyDrawdown, 0)} (resets ${snapshot.dailyLossResetTime})`} />
            <Row label="Min trading days" value={String(snapshot.minTradingDays)} />
            <Row label="Duration" value={snapshot.durationDays ? `${snapshot.durationDays} days` : "Unlimited"} />
            <Row label="Leverage" value={`1:${snapshot.leverage}`} />
            <Row label="Profit split" value={formatPercent(snapshot.profitSplit, 0)} />
            <Row label="Weekend holding" value={snapshot.weekendHoldingAllowed ? "Allowed" : "Not allowed"} />
          </dl>
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold">Recent Trades</h3>
          <Link href="/history" className="text-xs text-accent-2 hover:underline">
            Full history →
          </Link>
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
                <th className="px-4 py-2.5">Closed</th>
              </tr>
            </thead>
            <tbody>
              {account.trades.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted">
                    No trades yet.
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
                  <td className="px-4 py-2.5">{formatDateTime(t.closeTime ?? t.openTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </>
  );
}
