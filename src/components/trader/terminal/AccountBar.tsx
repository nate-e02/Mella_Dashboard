"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { StatusBadge } from "@/components/ui/Badge";
import { MeterBar, budgetTone } from "@/components/trader/dashboard/MeterBar";
import { clampPercent, etb, pnlClass, signedEtb } from "@/components/trader/dashboard/money";
import type { AccountMeta } from "@/lib/services/accountState";
import type { MarketStatus, SocketStatus } from "@/lib/hooks/useTradingSocket";
import type { AccountState } from "@/trading/protocol";

const CONNECTION_LABEL: Record<SocketStatus, { text: string; dot: string }> = {
  open: { text: "Live", dot: "bg-success" },
  connecting: { text: "Connecting…", dot: "bg-warning animate-pulse" },
  closed: { text: "Offline", dot: "bg-muted" },
  error: { text: "Reconnecting…", dot: "bg-danger animate-pulse" },
};

export function ConnectionDot({ status }: { status: SocketStatus }) {
  const info = CONNECTION_LABEL[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" role="status" aria-live="polite">
      <span className={clsx("inline-block h-2 w-2 rounded-full", info.dot)} aria-hidden="true" />
      {info.text}
    </span>
  );
}

export function MarketPill({ market, socketStatus }: { market: MarketStatus | null; socketStatus: SocketStatus }) {
  if (socketStatus !== "open" || !market) {
    return <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">Market: unknown</span>;
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
      Market {halted ? "halted" : "open"}
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
  const [expanded, setExpanded] = useState(false);

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
            <div className="text-muted">Equity</div>
            <div className="text-sm font-semibold tabular-nums">{equity != null ? etb(equity) : "—"}</div>
          </div>
          <div>
            <div className="text-muted">Floating P&amp;L</div>
            <div className={clsx("text-sm font-semibold tabular-nums", pnlClass(floating))}>{state ? signedEtb(floating) : "—"}</div>
          </div>
          <div>
            <div className="text-muted">Balance</div>
            <div className="text-sm font-semibold tabular-nums">{state ? etb(state.balance) : "—"}</div>
          </div>
        </div>

        <div className="lg:hidden">
          <MeterBar label="Daily loss used" percent={dailyUsedPct} tone={budgetTone(dailyUsedPct)} size="sm" />
        </div>

        <button
          type="button"
          className="btn-ghost !px-2 !py-1 self-start text-xs lg:hidden"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="account-details"
        >
          {expanded ? "Hide details ▲" : "Show details ▼"}
        </button>
      </div>

      <div id="account-details" className={clsx("border-t border-border p-3", expanded ? "block" : "hidden lg:block")}>
        {state ? (
          <div className="flex flex-col gap-3">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-muted">Free margin</dt>
              <dd className="text-right font-medium tabular-nums">{etb(state.freeMargin)}</dd>
              <dt className="text-muted">Margin used</dt>
              <dd className="text-right font-medium tabular-nums">{etb(state.marginUsed)}</dd>
              <dt className="text-muted">Realized P&amp;L</dt>
              <dd className={clsx("text-right font-medium tabular-nums", pnlClass(state.realizedPnl))}>{signedEtb(state.realizedPnl)}</dd>
              <dt className="text-muted">Leverage</dt>
              <dd className="text-right font-medium tabular-nums">1:{account.leverage}</dd>
            </dl>

            <MeterBar
              label="Daily loss used"
              percent={dailyUsedPct}
              tone={budgetTone(dailyUsedPct)}
              left={`${etb(state.dailyLossUsed)} used`}
              right={state.dailyLossLimit > 0 ? `limit ${etb(state.dailyLossLimit)}` : "no daily limit"}
            />
            <MeterBar
              label="Max loss used"
              percent={ddUsedPct}
              tone={budgetTone(ddUsedPct)}
              left={`${etb(state.drawdownRemaining)} remaining`}
              right={`floor ${etb(state.drawdownFloor)}`}
            />
            {state.profitTarget != null && targetPct != null ? (
              <MeterBar
                label="Profit target"
                percent={targetPct}
                tone={targetPct >= 100 ? "success" : "accent"}
                left={signedEtb(state.realizedPnl)}
                right={`target ${etb(state.profitTarget)}`}
              />
            ) : (
              <div className="text-xs text-muted">No profit target on this account.</div>
            )}

            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Trading days</span>
              <span className="font-medium tabular-nums">
                {state.tradingDays} / {state.minTradingDays} min
              </span>
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted">Loading account state…</div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs">
          <label className="inline-flex cursor-pointer items-center gap-2 text-muted">
            <input type="checkbox" className="h-3.5 w-3.5 accent-accent-2" checked={lowData} onChange={(e) => onToggleLowData(e.target.checked)} />
            Low-data mode
          </label>
          {socketStatus !== "open" && (
            <button type="button" className="btn-secondary !px-2 !py-1 text-xs" onClick={onReconnect}>
              Reconnect
            </button>
          )}
        </div>
        {socketStatus !== "open" && lastError && <div className="mt-2 text-[11px] text-danger">{lastError}</div>}
      </div>
    </div>
  );
}
