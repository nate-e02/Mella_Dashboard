"use client";

import { useState, type KeyboardEvent } from "react";
import { clsx } from "clsx";
import type { InstrumentInfo, PositionInfo, Tick } from "@/trading/protocol";
import { pnlClass, signedEtb } from "@/components/trader/dashboard/money";
import { formatPrice, pointSize, roundToStep, stepDecimals } from "./tradingMath";

export type ClosedTodaySummary = {
  since: string;
  count: number;
  wins: number;
  losses: number;
  netPnl: number;
  items: {
    id: string;
    symbol: string;
    side: "BUY" | "SELL";
    volume: number;
    entryPrice: number;
    exitPrice: number | null;
    netProfit: number;
    closeReason: string | null;
    closeTime: string;
  }[];
};

type ModifyFn = (positionId: string, risk: { stopLoss?: number | null; takeProfit?: number | null }) => Promise<boolean>;
type CloseFn = (positionId: string, volume?: number) => Promise<void>;

/** Live close price for a position: longs close on the bid, shorts on the ask. Falls back to the engine's last mark. */
function livePrice(position: PositionInfo, tick: Tick | undefined): number | null {
  if (tick) return position.side === "BUY" ? tick.bid : tick.ask;
  return position.currentPrice;
}

/** Inline-editable SL/TP value: click to edit, Enter saves, Esc cancels. */
function EditableLevel({
  label,
  value,
  digits,
  disabled,
  onSave,
}: {
  label: string;
  value: number | null;
  digits: number;
  disabled: boolean;
  onSave: (next: number | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  function startEditing() {
    setText(value != null ? value.toFixed(digits) : "");
    setEditing(true);
  }

  async function save() {
    const trimmed = text.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next != null && (!Number.isFinite(next) || next <= 0)) return;
    setSaving(true);
    try {
      if (await onSave(next)) setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={startEditing}
        className="rounded px-1 font-mono text-xs tabular-nums text-foreground underline decoration-dotted underline-offset-2 hover:bg-white/5 disabled:cursor-not-allowed disabled:no-underline"
        aria-label={`Edit ${label}${value != null ? `, currently ${value.toFixed(digits)}` : ", not set"}`}
      >
        {value != null ? value.toFixed(digits) : "—"}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        step={pointSize(digits)}
        autoFocus
        aria-label={label}
        className="input-base !w-24 !px-1.5 !py-0.5 font-mono text-xs"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        disabled={saving}
      />
      <button type="button" className="btn-primary !px-2 !py-0.5 text-[11px]" onClick={() => void save()} disabled={saving} aria-label={`Save ${label}`}>
        {saving ? "…" : "Save"}
      </button>
      <button type="button" className="btn-ghost !px-1.5 !py-0.5 text-[11px]" onClick={() => setEditing(false)} disabled={saving} aria-label={`Cancel editing ${label}`}>
        ✕
      </button>
    </span>
  );
}

function CloseControls({
  position,
  instrument,
  disabled,
  onClose,
}: {
  position: PositionInfo;
  instrument: InstrumentInfo | undefined;
  disabled: boolean;
  onClose: CloseFn;
}) {
  const step = instrument?.volumeStep ?? 0.01;
  const decimals = stepDecimals(step);
  // Remounted by the parent (key includes the volume) whenever a partial close changes the size.
  const [volumeText, setVolumeText] = useState(() => position.volume.toFixed(decimals));
  const [busy, setBusy] = useState(false);

  const parsed = Number(volumeText);
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= position.volume + 1e-9;
  const partial = valid && parsed < position.volume - 1e-9;

  async function close() {
    if (!valid) return;
    setBusy(true);
    try {
      await onClose(position.id, partial ? roundToStep(parsed, step) : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        inputMode="decimal"
        min={instrument?.minVolume ?? step}
        max={position.volume}
        step={step}
        aria-label={`Volume to close for ${position.symbol}`}
        className="input-base !w-20 !px-1.5 !py-0.5 font-mono text-xs"
        value={volumeText}
        onChange={(e) => setVolumeText(e.target.value)}
        disabled={disabled || busy}
      />
      <button
        type="button"
        className="btn-danger !px-2 !py-0.5 text-[11px]"
        onClick={() => void close()}
        disabled={disabled || busy || !valid}
        aria-label={`${partial ? "Partially close" : "Close"} ${position.symbol} ${position.side} position`}
      >
        {busy ? "…" : partial ? "Partial" : "Close"}
      </button>
    </div>
  );
}

export function PositionsPanel({
  positions,
  instruments,
  lastTick,
  closedToday,
  disabled,
  onClose,
  onModify,
}: {
  positions: PositionInfo[];
  instruments: Map<string, InstrumentInfo>;
  lastTick: Map<string, Tick>;
  closedToday: ClosedTodaySummary | null;
  disabled: boolean;
  onClose: CloseFn;
  onModify: ModifyFn;
}) {
  const [tab, setTab] = useState<"open" | "closed">("open");
  const totalFloating = positions.reduce((s, p) => s + p.floatingPnl, 0);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex gap-1" role="tablist" aria-label="Positions">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "open"}
            onClick={() => setTab("open")}
            className={clsx("rounded-md px-2 py-1 text-xs font-medium", tab === "open" ? "bg-accent-2/15 text-accent-2" : "text-muted hover:text-foreground")}
          >
            Open ({positions.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "closed"}
            onClick={() => setTab("closed")}
            className={clsx("rounded-md px-2 py-1 text-xs font-medium", tab === "closed" ? "bg-accent-2/15 text-accent-2" : "text-muted hover:text-foreground")}
          >
            Closed today{closedToday ? ` (${closedToday.count})` : ""}
          </button>
        </div>
        {tab === "open" && positions.length > 0 && (
          <div className={clsx("text-xs font-semibold tabular-nums", pnlClass(totalFloating))}>{signedEtb(totalFloating)}</div>
        )}
      </div>

      {tab === "open" ? (
        positions.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted">No open positions.</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[640px] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-left text-[10px] uppercase tracking-wide text-muted">
                    <th className="px-3 py-2">Symbol</th>
                    <th className="px-3 py-2">Side</th>
                    <th className="px-3 py-2 text-right">Lots</th>
                    <th className="px-3 py-2 text-right">Entry</th>
                    <th className="px-3 py-2 text-right">Current</th>
                    <th className="px-3 py-2">SL</th>
                    <th className="px-3 py-2">TP</th>
                    <th className="px-3 py-2 text-right">Floating P&amp;L</th>
                    <th className="px-3 py-2 text-right">Close</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => {
                    const instrument = instruments.get(p.symbol);
                    const digits = instrument?.digits ?? 5;
                    const current = livePrice(p, lastTick.get(p.symbol));
                    return (
                      <tr key={p.id} className="border-b border-border/60 last:border-0">
                        <td className="px-3 py-2 font-semibold">{p.symbol}</td>
                        <td className={clsx("px-3 py-2 font-medium", p.side === "BUY" ? "text-success" : "text-danger")}>{p.side}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{p.volume}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{formatPrice(p.entryPrice, digits)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{formatPrice(current, digits)}</td>
                        <td className="px-3 py-2">
                          <EditableLevel label={`stop loss for ${p.symbol}`} value={p.stopLoss} digits={digits} disabled={disabled} onSave={(v) => onModify(p.id, { stopLoss: v })} />
                        </td>
                        <td className="px-3 py-2">
                          <EditableLevel label={`take profit for ${p.symbol}`} value={p.takeProfit} digits={digits} disabled={disabled} onSave={(v) => onModify(p.id, { takeProfit: v })} />
                        </td>
                        <td className={clsx("px-3 py-2 text-right font-mono font-semibold tabular-nums", pnlClass(p.floatingPnl))}>{signedEtb(p.floatingPnl)}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end">
                            <CloseControls key={`${p.id}:${p.volume}`} position={p} instrument={instrument} disabled={disabled} onClose={onClose} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="flex flex-col divide-y divide-border/60 md:hidden">
              {positions.map((p) => {
                const instrument = instruments.get(p.symbol);
                const digits = instrument?.digits ?? 5;
                const current = livePrice(p, lastTick.get(p.symbol));
                return (
                  <li key={p.id} className="flex flex-col gap-2 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{p.symbol}</span>
                        <span className={clsx("font-medium", p.side === "BUY" ? "text-success" : "text-danger")}>{p.side}</span>
                        <span className="font-mono text-muted">{p.volume} lots</span>
                      </div>
                      <span className={clsx("font-mono font-semibold tabular-nums", pnlClass(p.floatingPnl))}>{signedEtb(p.floatingPnl)}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                      <span className="text-muted">Entry</span>
                      <span className="text-right font-mono tabular-nums">{formatPrice(p.entryPrice, digits)}</span>
                      <span className="text-muted">Current</span>
                      <span className="text-right font-mono tabular-nums">{formatPrice(current, digits)}</span>
                      <span className="text-muted">Stop loss</span>
                      <span className="text-right">
                        <EditableLevel label={`stop loss for ${p.symbol}`} value={p.stopLoss} digits={digits} disabled={disabled} onSave={(v) => onModify(p.id, { stopLoss: v })} />
                      </span>
                      <span className="text-muted">Take profit</span>
                      <span className="text-right">
                        <EditableLevel label={`take profit for ${p.symbol}`} value={p.takeProfit} digits={digits} disabled={disabled} onSave={(v) => onModify(p.id, { takeProfit: v })} />
                      </span>
                    </div>
                    <div className="flex justify-end">
                      <CloseControls key={`${p.id}:${p.volume}`} position={p} instrument={instrument} disabled={disabled} onClose={onClose} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )
      ) : (
        <div className="p-3 text-xs">
          {!closedToday ? (
            <div className="text-muted">Loading…</div>
          ) : closedToday.count === 0 ? (
            <div className="py-3 text-center text-muted">Nothing closed since the last daily reset.</div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  <span className="text-muted">Trades </span>
                  <span className="font-semibold tabular-nums">{closedToday.count}</span>
                </span>
                <span>
                  <span className="text-muted">W/L </span>
                  <span className="font-semibold tabular-nums">
                    {closedToday.wins}/{closedToday.losses}
                  </span>
                </span>
                <span>
                  <span className="text-muted">Net </span>
                  <span className={clsx("font-semibold tabular-nums", pnlClass(closedToday.netPnl))}>{signedEtb(closedToday.netPnl)}</span>
                </span>
              </div>
              <ul className="divide-y divide-border/60">
                {closedToday.items.map((t) => {
                  const digits = instruments.get(t.symbol)?.digits ?? 5;
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-2 py-1.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="font-semibold">{t.symbol}</span>
                        <span className={clsx("font-medium", t.side === "BUY" ? "text-success" : "text-danger")}>{t.side}</span>
                        <span className="font-mono text-muted">{t.volume}</span>
                        <span className="hidden font-mono text-muted sm:inline">
                          {formatPrice(t.entryPrice, digits)} → {formatPrice(t.exitPrice, digits)}
                        </span>
                        {t.closeReason && t.closeReason !== "MANUAL" && <span className="rounded bg-white/5 px-1 text-[10px] uppercase text-muted">{t.closeReason.replace("_", " ")}</span>}
                      </div>
                      <span className={clsx("font-mono font-semibold tabular-nums", pnlClass(t.netProfit))}>{signedEtb(t.netProfit)}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2 text-[10px] text-muted">Net of commission and swap, since the last daily reset.</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
