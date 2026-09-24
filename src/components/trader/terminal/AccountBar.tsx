"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/messages";
import { StatusBadge } from "@/components/ui/Badge";
import { MeterBar, budgetTone } from "@/components/trader/dashboard/MeterBar";
import { clampPercent, etb, pnlClass, signedEtb } from "@/components/trader/dashboard/money";
import type { AccountMeta } from "@/lib/services/accountState";
import type { MarketStatus, SocketStatus } from "@/lib/hooks/useTradingSocket";
import type { AccountState } from "@/trading/protocol";

const CONNECTION_LABEL: Record<SocketStatus, { text: MessageKey; dot: string }> = {
  open: { text: "trading.connection.open", dot: "bg-success" },
  connecting: { text: "trading.connection.connecting", dot: "bg-warning animate-pulse" },
  closed: { text: "trading.connection.closed", dot: "bg-muted" },
  error: { text: "trading.connection.error", dot: "bg-danger animate-pulse" },
};

export function ConnectionDot({ status }: { status: SocketStatus }) {
  const t = useT();
  const info = CONNECTION_LABEL[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" role="status" aria-live="polite">
      <span className={clsx("inline-block h-2 w-2 rounded-full", info.dot)} aria-hidden="true" />
      {t(info.text)}
    </span>
  );
}

export function MarketPill({ market, socketStatus }: { market: MarketStatus | null; socketStatus: SocketStatus }) {
  const t = useT();
  if (socketStatus !== "open" || !market) {
    return <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">{t("trading.market.unknown")}</span>;
  }
  const halted = market.state === "HALTED";
  return (
    <span
      className={clsx(
        "rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
        halted ? "border-danger/30 bg-danger/15 text-danger" : "border-success/30 bg-success/15 text-success",
      )}
      title={market.reason}
    >
      {halted ? t("trading.market.halted") : t("trading.market.open")}
      {halted && market.reason ? ` · ${market.reason}` : ""}
    </span>
  );
}

export function AccountBar({
  account,
  state,
  marketState,
  socketStatus,
  lastError,
  onReconnect,
  lowData,
  onToggleLowData,
}: {
  account: AccountMeta;
  state: AccountState | null;
  marketState: MarketStatus | null;
  socketStatus: SocketStatus;
  lastError: string | null;
  onReconnect: () => void;
  lowData: boolean;
  onToggleLowData: (value: boolean) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const restrictive = [
    !account.rules.weekendHoldingAllowed && t("trading.rules.noWeekend"),
    !account.rules.overnightHoldingAllowed && t("trading.rules.noOvernight"),
    !account.rules.newsTradingAllowed && t("trading.rules.noNews"),
  ].filter(Boolean) as string[];

  const equity = state?.equity ?? null;
  const floating = state?.floatingPnl ?? 0;
  const dailyUsedPct = state && state.dailyLossLimit > 0 ? clampPercent((state.dailyLossUsed / state.dailyLossLimit) * 100) : 0;
  const ddAllowance = state ? Math.max(state.drawdownRemaining, account.startingBalance - state.drawdownFloor) : 0;
  const ddUsedPct = state && ddAllowance > 0 ? clampPercent(((ddAllowance - state.drawdownRemaining) / ddAllowance) * 100) : 0;
  const targetPct = state?.profitProgress ?? null;

  return (
    <div className="card overflow-hidden">
      {/* Always-visible summary strip (sticky on mobile) */}
      <div className="flex flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold">{account.name}</span>
            <StatusBadge status={account.status} />
          </div>
          <div className="flex items-center gap-2">
            <MarketPill market={marketState} socketStatus={socketStatus} />
            <ConnectionDot status={socketStatus} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-muted">{t("trading.equity")}</div>
            <div className="text-sm font-semibold tabular-nums">{equity != null ? etb(equity) : "—"}</div>
          </div>
          <div>
            <div className="text-muted">{t("trading.floatingPnl")}</div>
            <div className={clsx("text-sm font-semibold tabular-nums", pnlClass(floating))}>{state ? signedEtb(floating) : "—"}</div>
          </div>
          <div>
            <div className="text-muted">{t("trading.balance")}</div>
            <div className="text-sm font-semibold tabular-nums">{state ? etb(state.balance) : "—"}</div>
          </div>
        </div>

        <div className="lg:hidden">
          <MeterBar label={t("trading.dailyLossUsed")} percent={dailyUsedPct} tone={budgetTone(dailyUsedPct)} size="sm" />
        </div>

        <button
          type="button"
          className="btn-ghost !px-2 !py-1 self-start text-xs lg:hidden"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="account-details"
        >
          {expanded ? t("trading.account.hideDetails") : t("trading.account.showDetails")}
        </button>
      </div>

      <div id="account-details" className={clsx("border-t border-border p-3", expanded ? "block" : "hidden lg:block")}>
        {state ? (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-muted">{t("trading.freeMargin")}</dt>
              <dd className="text-right font-medium tabular-nums">{etb(state.freeMargin)}</dd>
              <dt className="text-muted">{t("trading.marginUsed")}</dt>
              <dd className="text-right font-medium tabular-nums">{etb(state.marginUsed)}</dd>
              <dt className="text-muted">{t("trading.realizedPnl")}</dt>
              <dd className={clsx("text-right font-medium tabular-nums", pnlClass(state.realizedPnl))}>{signedEtb(state.realizedPnl)}</dd>
              <dt className="text-muted">{t("trading.leverage")}</dt>
              <dd className="text-right font-medium tabular-nums">1:{account.leverage}</dd>
            </dl>

            <MeterBar
              label={t("trading.dailyLossUsed")}
              percent={dailyUsedPct}
              tone={budgetTone(dailyUsedPct)}
              left={t("trading.meter.used", { amount: etb(state.dailyLossUsed) })}
              right={state.dailyLossLimit > 0 ? t("trading.meter.limit", { amount: etb(state.dailyLossLimit) }) : t("trading.meter.noDailyLimit")}
            />
            <MeterBar
              label={t("trading.maxLossUsed")}
              percent={ddUsedPct}
              tone={budgetTone(ddUsedPct)}
              left={t("trading.meter.remaining", { amount: etb(state.drawdownRemaining) })}
              right={t("trading.meter.floor", { amount: etb(state.drawdownFloor) })}
            />
            {state.profitTarget != null && targetPct != null ? (
              <MeterBar
                label={t("trading.profitTarget")}
                percent={targetPct}
                tone={targetPct >= 100 ? "success" : "accent"}
                left={signedEtb(state.realizedPnl)}
                right={t("trading.meter.target", { amount: etb(state.profitTarget) })}
              />
            ) : (
              <div className="text-xs text-muted">{t("trading.account.noTarget")}</div>
            )}

            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">{t("trading.tradingDays")}</span>
              <span className="font-medium tabular-nums">{t("trading.tradingDaysValue", { days: state.tradingDays, min: state.minTradingDays })}</span>
            </div>
            {restrictive.length > 0 && (
              <div className="flex flex-wrap gap-1 text-[10px]">
                {restrictive.map((r) => (
                  <span key={r} className="rounded bg-warning/10 px-1.5 py-0.5 text-warning">
                    {r}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted">{t("trading.account.loadingState")}</div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs">
          <label className="inline-flex cursor-pointer items-center gap-2 text-muted">
            <input type="checkbox" className="h-3.5 w-3.5 accent-accent-2" checked={lowData} onChange={(e) => onToggleLowData(e.target.checked)} />
            {t("trading.account.lowData")}
          </label>
          {socketStatus !== "open" && (
            <button type="button" className="btn-secondary !px-2 !py-1 text-xs" onClick={onReconnect}>
              {t("trading.account.reconnect")}
            </button>
          )}
        </div>
        {socketStatus !== "open" && lastError && <div className="mt-2 text-[11px] text-danger">{lastError}</div>}
      </div>
    </div>
  );
}
