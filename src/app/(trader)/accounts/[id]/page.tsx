import { notFound } from "next/navigation";
import Link from "next/link";
import { getT } from "@/i18n/server";
import { requireTraderPage } from "@/lib/auth/pageGuards";
import { prisma } from "@/lib/prisma";
import { refreshAccount } from "@/lib/services/accounts";
import { buildEquityCurveFromDb, computeAccountMetricsFromDb, computeConsistency } from "@/lib/services/accountMetrics";
import { rulesOf } from "@/lib/services/accountState";
import { dailyLossFloor, maxDrawdownFloor } from "@/lib/services/challengeRules";
import { StatCard } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { EquityCurveChart } from "@/components/ui/Charts";
import { formatCurrency, formatDateTime, formatPercent, formatSigned } from "@/lib/format";
import type { TemplateSnapshot } from "@/types";
import { RulesList } from "@/components/trader/dashboard/RulesList";
import { closeReasonLabel, failureLabel, isRuleClose, phaseLabel } from "@/components/trader/terminal/messages";

const SIDE_KEYS = { BUY: "trading.side.BUY", SELL: "trading.side.SELL" } as const;

export const dynamic = "force-dynamic";

export default async function TraderAccountAnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const [user, { id }] = await Promise.all([requireTraderPage(), params]);

  // Ownership is checked BEFORE any evaluation runs, so a trader cannot
  // trigger writes on someone else's account by guessing an id.
  const owner = await prisma.tradingAccount.findUnique({ where: { id }, select: { userId: true } });
  if (!owner || owner.userId !== user.id) notFound();

  const account = await refreshAccount(id);
  if (!account) notFound();

  const [metrics, curve, consistency, t] = await Promise.all([
    computeAccountMetricsFromDb(account),
    buildEquityCurveFromDb(account.id, account.startingBalance),
    computeConsistency(account),
    getT(),
  ]);
  const snapshot = account.snapshot as unknown as TemplateSnapshot;
  const rules = rulesOf(snapshot);
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
          {t("trading.account.backToDashboard")}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{snapshot.name ?? account.template?.name ?? t("trading.account.defaultName")}</h1>
          <StatusBadge status={account.status} />
          {account.failureReason && <span className="text-xs text-danger">{failureLabel(t, account.failureReason)}</span>}
        </div>
        <p className="text-xs text-muted">
          {phaseLabel(t, account.phase)} · {t("trading.objectives.started", { date: formatDateTime(account.createdAt) })}
          {account.expiresAt ? ` · ${t("trading.account.ends", { date: formatDateTime(account.expiresAt) })}` : ""}
        </p>
      </div>

      {progress !== null && (
        <div className="card p-4">
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>{t("trading.account.targetProgress", { amount: formatCurrency(metrics.netPnl, currency), target: formatCurrency(targetAmount!, currency) })}</span>
            <span>{formatPercent(progress, 0)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-gradient-to-r from-accent-2 to-accent" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label={t("trading.balance")} value={formatCurrency(account.balance, currency)} />
        <StatCard label={t("trading.equity")} value={formatCurrency(account.equity, currency)} />
        <StatCard label={t("trading.account.netPnl")} value={formatSigned(metrics.netPnl, currency)} tone={metrics.netPnl >= 0 ? "success" : "danger"} />
        <StatCard label={t("trading.floatingPnl")} value={formatSigned(metrics.unrealizedPnl, currency)} tone={metrics.unrealizedPnl >= 0 ? "success" : "danger"} />
        <StatCard
          label={t("trading.dailyLossUsed")}
          value={`${formatCurrency(dailyUsed, currency)} / ${formatCurrency(dailyLimit, currency)}`}
          sublabel={t("trading.account.failsAt", { amount: formatCurrency(dlFloor, currency) })}
          tone={dailyUsed > dailyLimit * 0.8 ? "danger" : "default"}
        />
        <StatCard
          label={t("trading.account.maxLossRemaining")}
          value={formatCurrency(Math.max(0, account.equity - ddFloor), currency)}
          sublabel={t(snapshot.drawdownMode === "TRAILING" ? "trading.account.trailingFloor" : "trading.account.staticFloor", { amount: formatCurrency(ddFloor, currency) })}
        />
        <StatCard label={t("trading.account.winRate")} value={hasTrades ? formatPercent(metrics.winRate) : "—"} />
        <StatCard label={t("trading.account.profitFactor")} value={metrics.profitFactor != null ? metrics.profitFactor.toFixed(2) : "—"} />
        <StatCard label={t("trading.positions.trades")} value={metrics.totalTrades} />
        <StatCard label={t("trading.account.avgWinLoss")} value={`${formatCurrency(metrics.avgWin, currency)} / ${formatCurrency(-metrics.avgLoss, currency)}`} />
        <StatCard label={t("trading.account.largestWinLoss")} value={`${formatCurrency(metrics.largestWin, currency)} / ${formatCurrency(metrics.largestLoss, currency)}`} />
        <StatCard label={t("trading.tradingDays")} value={t("trading.tradingDaysValue", { days: metrics.tradingDays, min: snapshot.minTradingDays })} />
        {consistency.enabled && (
          <StatCard
            label={t("trading.consistency.label")}
            value={consistency.ratioPercent != null ? t("trading.consistency.value", { ratio: Math.round(consistency.ratioPercent), limit: consistency.limitPercent ?? 0 }) : "—"}
            sublabel={
              consistency.ratioPercent == null
                ? t("trading.consistency.notYet", { limit: consistency.limitPercent ?? 0 })
                : consistency.ok
                  ? t("trading.consistency.ok")
                  : t("trading.consistency.notOkHint", { best: formatCurrency(consistency.bestDay, currency), total: formatCurrency(consistency.total, currency) })
            }
            tone={consistency.ratioPercent == null ? "default" : consistency.ok ? "success" : "warning"}
          />
        )}
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold">{t("trading.account.equityCurve")}</h3>
        {curve.length > 1 ? (
          <EquityCurveChart data={curve} currency={currency} />
        ) : (
          <div className="flex h-48 flex-col items-center justify-center text-center">
            <div className="text-sm font-medium">{t("trading.account.noClosedTitle")}</div>
            <div className="mt-1 text-xs text-muted">{t("trading.account.noClosedBody")}</div>
          </div>
        )}
      </div>

      {account.positions.length > 0 && (
        <div className="card !p-0 overflow-hidden">
          <div className="border-b border-border px-5 py-3 text-sm font-semibold">{t("trading.account.openPositions")}</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5">{t("trading.col.symbol")}</th>
                  <th className="px-4 py-2.5">{t("trading.col.side")}</th>
                  <th className="px-4 py-2.5">{t("trading.col.volume")}</th>
                  <th className="px-4 py-2.5">{t("trading.col.entry")}</th>
                  <th className="px-4 py-2.5">{t("trading.col.current")}</th>
                  <th className="px-4 py-2.5">{t("trading.floatingPnl")}</th>
                  <th className="px-4 py-2.5">{t("trading.col.opened")}</th>
                </tr>
              </thead>
              <tbody>
                {account.positions.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 font-medium">{p.symbol}</td>
                    <td className="px-4 py-2.5">{t(SIDE_KEYS[p.side])}</td>
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
          <h3 className="mb-3 text-sm font-semibold">{t("trading.account.winLossTitle")}</h3>
          {metrics.closedTrades > 0 ? (
            <div className="flex items-center gap-4">
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-danger/30">
                <div className="h-full bg-success" style={{ width: `${metrics.winRate}%` }} />
              </div>
              <span className="text-xs text-muted">{t("trading.account.winLossValue", { wins: metrics.winningTrades, losses: metrics.losingTrades })}</span>
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-muted">{t("trading.account.noAnalyze")}</div>
          )}
        </div>
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold">{t("trading.account.rulesTitle")}</h3>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <Row label={t("trading.profitTarget")} value={snapshot.profitTarget != null ? formatPercent(snapshot.profitTarget, 0) : "—"} />
            <Row
              label={t("trading.maxLoss")}
              value={t(snapshot.drawdownMode === "TRAILING" ? "trading.account.maxLossTrailing" : "trading.account.maxLossStatic", { percent: formatPercent(snapshot.maxDrawdown, 0) })}
            />
            <Row label={t("trading.dailyLoss")} value={t("trading.account.dailyLossRule", { percent: formatPercent(snapshot.dailyDrawdown, 0), reset: snapshot.dailyLossResetTime })} />
            <Row label={t("trading.account.minTradingDays")} value={String(snapshot.minTradingDays)} />
            <Row label={t("trading.account.duration")} value={snapshot.durationDays ? t("trading.account.durationDays", { days: snapshot.durationDays }) : t("trading.account.unlimited")} />
            <Row label={t("trading.leverage")} value={`1:${snapshot.leverage}`} />
            <Row label={t("trading.account.profitSplit")} value={formatPercent(snapshot.profitSplit, 0)} />
            <Row label={t("trading.consistency.label")} value={rules.consistencyLimitPercent != null ? t("trading.consistency.rule", { limit: rules.consistencyLimitPercent }) : t("trading.consistency.none")} />
            <RulesList rules={rules} t={t} />
          </dl>
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold">{t("trading.account.recentTrades")}</h3>
          <Link href="/history" className="text-xs text-accent-2 hover:underline">
            {t("trading.account.fullHistory")}
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">{t("trading.col.symbol")}</th>
                <th className="px-4 py-2.5">{t("trading.col.side")}</th>
                <th className="px-4 py-2.5">{t("trading.col.volume")}</th>
                <th className="px-4 py-2.5">{t("trading.col.entry")}</th>
                <th className="px-4 py-2.5">{t("trading.col.exit")}</th>
                <th className="px-4 py-2.5">{t("trading.account.netPnl")}</th>
                <th className="px-4 py-2.5">{t("trading.col.closed")}</th>
              </tr>
            </thead>
            <tbody>
              {account.trades.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted">
                    {t("trading.account.noTrades")}
                  </td>
                </tr>
              )}
              {account.trades.map((tr) => (
                <tr key={tr.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 font-medium">
                    {tr.symbol}
                    {tr.closeReason && tr.closeReason !== "MANUAL" && (
                      <span className={`ml-2 rounded px-1 text-[10px] uppercase ${isRuleClose(tr.closeReason) ? "bg-warning/15 text-warning" : "bg-white/5 text-muted"}`}>
                        {closeReasonLabel(t, tr.closeReason)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">{t(SIDE_KEYS[tr.side])}</td>
                  <td className="px-4 py-2.5">{tr.volume}</td>
                  <td className="px-4 py-2.5">{tr.entryPrice}</td>
                  <td className="px-4 py-2.5">{tr.exitPrice ?? "—"}</td>
                  <td className={`px-4 py-2.5 ${tr.netProfit >= 0 ? "text-success" : "text-danger"}`}>{formatSigned(tr.netProfit, currency)}</td>
                  <td className="px-4 py-2.5">{formatDateTime(tr.closeTime ?? tr.openTime)}</td>
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
