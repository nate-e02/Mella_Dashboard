import Link from "next/link";
import { clsx } from "clsx";
import { StatusBadge } from "@/components/ui/Badge";
import type { AccountStateEntry } from "@/lib/services/accountState";
import { formatDate } from "@/lib/format";
import { MeterBar, budgetTone } from "./MeterBar";
import { clampPercent, etb, pnlClass, signedEtb } from "./money";

const PHASE_LABEL: Record<string, string> = { PHASE_1: "Phase 1", PHASE_2: "Phase 2", FUNDED: "Funded" };

function daysRemaining(expiresAt: string | null, now: Date): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/** FTMO MetriX-style objectives card for one trading account. */
export function ObjectivesCard({ entry, now }: { entry: AccountStateEntry; now: Date }) {
  const { meta, state } = entry;
  const pnl = state.balance - meta.startingBalance;
  const dailyUsedPct = state.dailyLossLimit > 0 ? clampPercent((state.dailyLossUsed / state.dailyLossLimit) * 100) : 0;
  const ddAllowance = Math.max(state.drawdownRemaining, meta.startingBalance - state.drawdownFloor);
  const ddUsedPct = ddAllowance > 0 ? clampPercent(((ddAllowance - state.drawdownRemaining) / ddAllowance) * 100) : 0;
  const days = daysRemaining(meta.expiresAt, now);
  const daysOk = state.minTradingDays === 0 || state.tradingDays >= state.minTradingDays;

  return (
    <article className="card flex flex-col gap-4 p-4" aria-label={`${meta.name} objectives`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{meta.name}</h2>
          <div className="mt-0.5 text-xs text-muted">
            {PHASE_LABEL[meta.phase] ?? meta.phase} · started {formatDate(meta.createdAt)}
            {days != null && meta.tradable && <> · {days === 0 ? "expires today" : `${days} day${days === 1 ? "" : "s"} left`}</>}
          </div>
        </div>
        <StatusBadge status={meta.status} />
      </header>

      {meta.status === "FAILED" && meta.failureReason && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">Failed: {meta.failureReason.replace(/_/g, " ").toLowerCase()}</div>
      )}

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-muted">Balance</div>
          <div className="font-semibold tabular-nums">{etb(state.balance)}</div>
        </div>
        <div>
          <div className="text-muted">Equity</div>
          <div className="font-semibold tabular-nums">{etb(state.equity)}</div>
        </div>
        <div>
          <div className="text-muted">P&amp;L</div>
          <div className={clsx("font-semibold tabular-nums", pnlClass(pnl))}>{signedEtb(pnl)}</div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {state.profitTarget != null && state.profitProgress != null ? (
          <MeterBar
            label="Profit target"
            percent={state.profitProgress}
            tone={state.profitProgress >= 100 ? "success" : "accent"}
            left={`${signedEtb(state.realizedPnl)} realized`}
            right={`target ${etb(state.profitTarget)}`}
          />
        ) : (
          <div className="text-xs text-muted">{meta.phase === "FUNDED" ? "Funded account: no profit target, keep within the loss limits." : "No profit target."}</div>
        )}
        <MeterBar
          label="Daily loss"
          percent={dailyUsedPct}
          tone={budgetTone(dailyUsedPct)}
          left={`${etb(state.dailyLossUsed)} used`}
          right={state.dailyLossLimit > 0 ? `limit ${etb(state.dailyLossLimit)}` : "no daily limit"}
        />
        <MeterBar
          label="Max loss"
          percent={ddUsedPct}
          tone={budgetTone(ddUsedPct)}
          left={`${etb(state.drawdownRemaining)} remaining`}
          right={`floor ${etb(state.drawdownFloor)}`}
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">Trading days</dt>
        <dd className={clsx("text-right font-medium tabular-nums", daysOk ? "text-success" : "text-foreground")}>
          {state.tradingDays} / {state.minTradingDays} min{daysOk ? " ✓" : ""}
        </dd>
        <dt className="text-muted">Open positions</dt>
        <dd className="text-right font-medium tabular-nums">{state.positions.length}</dd>
        <dt className="text-muted">Floating P&amp;L</dt>
        <dd className={clsx("text-right font-medium tabular-nums", pnlClass(state.floatingPnl))}>{signedEtb(state.floatingPnl)}</dd>
      </dl>

      <footer className="mt-auto flex flex-wrap gap-2">
        {meta.tradable && (
          <Link href="/trade" className="btn-primary !py-1.5 text-xs">
            Open terminal
          </Link>
        )}
        <Link href={`/accounts/${meta.id}`} className="btn-secondary !py-1.5 text-xs">
          Account details
        </Link>
      </footer>
    </article>
  );
}
