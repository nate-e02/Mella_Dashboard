import Link from "next/link";
import { clsx } from "clsx";
import { getT } from "@/i18n/server";
import { StatusBadge } from "@/components/ui/Badge";
import type { AccountStateEntry } from "@/lib/services/accountState";
import { formatDate } from "@/lib/format";
import { failureLabel, phaseLabel } from "@/components/trader/terminal/messages";
import { MeterBar, budgetTone } from "./MeterBar";
import { clampPercent, etb, pnlClass, signedEtb } from "./money";
import { RulesList } from "./RulesList";

function daysRemaining(expiresAt: string | null, now: Date): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/** FTMO MetriX-style objectives card for one trading account. */
export async function ObjectivesCard({ entry, now }: { entry: AccountStateEntry; now: Date }) {
  const t = await getT();
  const { meta, state, consistency } = entry;
  const pnl = state.balance - meta.startingBalance;
  const dailyUsedPct = state.dailyLossLimit > 0 ? clampPercent((state.dailyLossUsed / state.dailyLossLimit) * 100) : 0;
  const ddAllowance = Math.max(state.drawdownRemaining, meta.startingBalance - state.drawdownFloor);
  const ddUsedPct = ddAllowance > 0 ? clampPercent(((ddAllowance - state.drawdownRemaining) / ddAllowance) * 100) : 0;
  const days = daysRemaining(meta.expiresAt, now);
  const daysOk = state.minTradingDays === 0 || state.tradingDays >= state.minTradingDays;

  return (
    <article className="card flex flex-col gap-4 p-4" aria-label={t("trading.objectives.aria", { name: meta.name })}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{meta.name}</h2>
          <div className="mt-0.5 text-xs text-muted">
            {phaseLabel(t, meta.phase)} · {t("trading.objectives.started", { date: formatDate(meta.createdAt) })}
            {days != null && meta.tradable && <> · {days === 0 ? t("trading.objectives.expiresToday") : t("trading.objectives.daysLeft", { days })}</>}
          </div>
        </div>
        <StatusBadge status={meta.status} />
      </header>

      {meta.status === "FAILED" && meta.failureReason && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{t("trading.objectives.failed", { reason: failureLabel(t, meta.failureReason) })}</div>
      )}

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-muted">{t("trading.balance")}</div>
          <div className="font-semibold tabular-nums">{etb(state.balance)}</div>
        </div>
        <div>
          <div className="text-muted">{t("trading.equity")}</div>
          <div className="font-semibold tabular-nums">{etb(state.equity)}</div>
        </div>
        <div>
          <div className="text-muted">{t("trading.pnl")}</div>
          <div className={clsx("font-semibold tabular-nums", pnlClass(pnl))}>{signedEtb(pnl)}</div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {state.profitTarget != null && state.profitProgress != null ? (
          <MeterBar
            label={t("trading.profitTarget")}
            percent={state.profitProgress}
            tone={state.profitProgress >= 100 ? "success" : "accent"}
            left={t("trading.meter.realized", { amount: signedEtb(state.realizedPnl) })}
            right={t("trading.meter.target", { amount: etb(state.profitTarget) })}
          />
        ) : (
          <div className="text-xs text-muted">{meta.phase === "FUNDED" ? t("trading.objectives.fundedNoTarget") : t("trading.objectives.noTarget")}</div>
        )}
        <MeterBar
          label={t("trading.dailyLoss")}
          percent={dailyUsedPct}
          tone={budgetTone(dailyUsedPct)}
          left={t("trading.meter.used", { amount: etb(state.dailyLossUsed) })}
          right={state.dailyLossLimit > 0 ? t("trading.meter.limit", { amount: etb(state.dailyLossLimit) }) : t("trading.meter.noDailyLimit")}
        />
        <MeterBar
          label={t("trading.maxLoss")}
          percent={ddUsedPct}
          tone={budgetTone(ddUsedPct)}
          left={t("trading.meter.remaining", { amount: etb(state.drawdownRemaining) })}
          right={t("trading.meter.floor", { amount: etb(state.drawdownFloor) })}
        />
        {consistency?.enabled &&
          (consistency.ratioPercent == null ? (
            <div className="text-xs">
              <div className="text-muted">{t("trading.consistency.label")}</div>
              <div className="mt-0.5 text-[11px] text-muted">{t("trading.consistency.notYet", { limit: consistency.limitPercent ?? 0 })}</div>
            </div>
          ) : (
            <MeterBar
              label={t("trading.consistency.label")}
              percent={consistency.limitPercent ? (consistency.ratioPercent / consistency.limitPercent) * 100 : 0}
              tone={consistency.ok ? "success" : "danger"}
              ariaLabel={t("trading.consistency.value", { ratio: Math.round(consistency.ratioPercent), limit: consistency.limitPercent ?? 0 })}
              left={t("trading.consistency.value", { ratio: Math.round(consistency.ratioPercent), limit: consistency.limitPercent ?? 0 })}
              right={consistency.ok ? t("trading.consistency.ok") : t("trading.consistency.notOk")}
            />
          ))}
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">{t("trading.tradingDays")}</dt>
        <dd className={clsx("text-right font-medium tabular-nums", daysOk ? "text-success" : "text-foreground")}>
          {t("trading.tradingDaysValue", { days: state.tradingDays, min: state.minTradingDays })}
          {daysOk ? " ✓" : ""}
        </dd>
        <dt className="text-muted">{t("trading.objectives.openPositions")}</dt>
        <dd className="text-right font-medium tabular-nums">{state.positions.length}</dd>
        <dt className="text-muted">{t("trading.floatingPnl")}</dt>
        <dd className={clsx("text-right font-medium tabular-nums", pnlClass(state.floatingPnl))}>{signedEtb(state.floatingPnl)}</dd>
      </dl>

      <RulesList rules={meta.rules} t={t} compact />

      <footer className="mt-auto flex flex-wrap gap-2">
        {meta.tradable && (
          <Link href="/trade" className="btn-primary !py-1.5 text-xs">
            {t("trading.objectives.openTerminal")}
          </Link>
        )}
        <Link href={`/accounts/${meta.id}`} className="btn-secondary !py-1.5 text-xs">
          {t("trading.objectives.details")}
        </Link>
      </footer>
    </article>
  );
}
