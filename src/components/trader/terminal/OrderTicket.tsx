"use client";

import { useMemo, useState, type FormEvent } from "react";
import { clsx } from "clsx";
import { formatCurrency } from "@/lib/format";
import type { AccountMeta } from "@/lib/services/accountState";
import type { MarketStatus, SocketStatus } from "@/lib/hooks/useTradingSocket";
import type { AccountState, InstrumentInfo, OrderKind, Side, Tick } from "@/trading/protocol";
import { etb } from "@/components/trader/dashboard/money";
import {
  clampVolume,
  estimateCommission,
  estimateMargin,
  formatPrice,
  marketFillPrice,
  parseNumberField,
  pipValue,
  pointSize,
  roundToStep,
  spreadPoints,
  stepDecimals,
  validatePendingPrice,
  validateProtectiveLevels,
} from "./tradingMath";

export type OrderDraft = {
  symbol: string;
  side: Side;
  orderType: OrderKind;
  volume: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
};

const ORDER_TYPES: OrderKind[] = ["MARKET", "LIMIT", "STOP"];

export function OrderTicket({
  accounts,
  account,
  onAccountChange,
  instrument,
  tick,
  state,
  fxRates,
  marketState,
  socketStatus,
  onPlaceOrder,
}: {
  accounts: AccountMeta[];
  account: AccountMeta;
  onAccountChange: (id: string) => void;
  instrument: InstrumentInfo | undefined;
  tick: Tick | undefined;
  state: AccountState | null;
  fxRates: Record<string, number>;
  marketState: MarketStatus | null;
  socketStatus: SocketStatus;
  onPlaceOrder: (draft: OrderDraft) => Promise<void>;
}) {
  const [side, setSide] = useState<Side>("BUY");
  const [orderType, setOrderType] = useState<OrderKind>("MARKET");
  // The parent remounts the ticket (key=symbol) when the instrument changes, so the initial volume is per-instrument.
  const [volumeText, setVolumeText] = useState(() => (instrument ? instrument.minVolume.toFixed(stepDecimals(instrument.volumeStep)) : "0.01"));
  const [priceText, setPriceText] = useState("");
  const [slText, setSlText] = useState("");
  const [tpText, setTpText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const symbol = instrument?.symbol ?? "";
  const digits = instrument?.digits ?? 5;
  const step = instrument?.volumeStep ?? 0.01;
  const volDecimals = stepDecimals(step);

  const bid = tick?.bid ?? null;
  const ask = tick?.ask ?? null;
  const volume = parseNumberField(volumeText);
  const price = parseNumberField(priceText);
  const stopLoss = parseNumberField(slText);
  const takeProfit = parseNumberField(tpText);

  const referencePrice = orderType === "MARKET" ? (bid != null && ask != null ? marketFillPrice(side, bid, ask) : null) : price;

  const volumeError = useMemo(() => {
    if (!instrument) return "No instrument selected";
    if (volume == null || Number.isNaN(volume) || volume <= 0) return "Enter a volume";
    if (volume < instrument.minVolume) return `Minimum ${instrument.minVolume} lots`;
    if (volume > instrument.maxVolume) return `Maximum ${instrument.maxVolume} lots`;
    if (Math.abs(roundToStep(volume, instrument.volumeStep) - volume) > 1e-9) return `Volume step is ${instrument.volumeStep}`;
    return null;
  }, [instrument, volume]);

  const priceError = validatePendingPrice({ orderType, side, price: Number.isNaN(price) ? Number.NaN : price, bid, ask });
  const levels = validateProtectiveLevels({
    side,
    entry: referencePrice != null && !Number.isNaN(referencePrice) ? referencePrice : null,
    stopLoss: Number.isNaN(stopLoss) ? Number.NaN : stopLoss,
    takeProfit: Number.isNaN(takeProfit) ? Number.NaN : takeProfit,
  });

  const halted = marketState?.state === "HALTED";
  const offline = socketStatus !== "open";
  const noQuote = orderType === "MARKET" && (bid == null || ask == null);

  const blockReason = offline
    ? socketStatus === "connecting"
      ? "Connecting to the trading server…"
      : "Not connected to the trading server"
    : halted
      ? `Market halted${marketState?.reason ? `: ${marketState.reason}` : ""}`
      : !account.tradable
        ? `Account is ${account.status.toLowerCase()}; trading is disabled`
        : noQuote
          ? "Waiting for a price…"
          : null;

  const validationError = volumeError ?? priceError ?? levels.stopLoss ?? levels.takeProfit;
  const canSubmit = !submitting && !blockReason && !validationError && Boolean(instrument);

  // Estimates in the account currency when a conversion rate is known, otherwise in the quote currency.
  const quote = instrument?.quoteCurrency ?? "USD";
  const rate = fxRates[quote];
  const estCurrency = rate != null ? "ETB" : quote;
  const conv = rate ?? 1;
  const safeVolume = instrument && volume != null && !Number.isNaN(volume) && volume > 0 ? volume : 0;
  const marginEstimate = instrument && referencePrice != null && !Number.isNaN(referencePrice) ? estimateMargin(instrument, safeVolume, referencePrice, account.leverage, conv) : null;
  const pipEstimate = instrument ? pipValue(instrument, safeVolume, conv) : null;
  const commissionEstimate = instrument ? estimateCommission(instrument, safeVolume) : null;
  const freeMargin = state?.freeMargin ?? null;
  const marginTooHigh = marginEstimate != null && freeMargin != null && rate != null && marginEstimate > freeMargin;

  function bumpVolume(direction: 1 | -1) {
    if (!instrument) return;
    const current = volume != null && !Number.isNaN(volume) ? volume : instrument.minVolume;
    const next = clampVolume(current + direction * instrument.volumeStep, instrument);
    setVolumeText(next.toFixed(volDecimals));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!instrument || !canSubmit || volume == null) return;
    setSubmitting(true);
    try {
      await onPlaceOrder({
        symbol: instrument.symbol,
        side,
        orderType,
        volume: clampVolume(volume, instrument),
        price: orderType !== "MARKET" && price != null ? price : undefined,
        stopLoss: stopLoss != null && !Number.isNaN(stopLoss) ? stopLoss : undefined,
        takeProfit: takeProfit != null && !Number.isNaN(takeProfit) ? takeProfit : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const spread = bid != null && ask != null ? spreadPoints(bid, ask, digits) : null;
  const pricePlaceholder = referencePrice != null && orderType === "MARKET" ? formatPrice(referencePrice, digits) : "0." + "0".repeat(digits);

  return (
    <form className="card flex flex-col gap-3 p-3" onSubmit={handleSubmit} aria-label="Order ticket">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">New order</h2>
        <label className="sr-only" htmlFor="ticket-account">
          Trading account
        </label>
        <select id="ticket-account" className="input-base !w-auto max-w-[60%] !py-1 text-xs" value={account.id} onChange={(e) => onAccountChange(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.phase.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>

      {/* Side toggles with live prices */}
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Order side">
        <button
          type="button"
          aria-pressed={side === "SELL"}
          onClick={() => setSide("SELL")}
          className={clsx(
            "flex flex-col items-center rounded-lg border px-2 py-2 transition",
            side === "SELL" ? "border-danger/60 bg-danger/20 text-danger" : "border-border bg-surface-2 text-muted hover:text-foreground",
          )}
        >
          <span className="text-[11px] font-medium uppercase tracking-wide">Sell</span>
          <span className="font-mono text-sm tabular-nums">{formatPrice(bid, digits)}</span>
        </button>
        <button
          type="button"
          aria-pressed={side === "BUY"}
          onClick={() => setSide("BUY")}
          className={clsx(
            "flex flex-col items-center rounded-lg border px-2 py-2 transition",
            side === "BUY" ? "border-success/60 bg-success/20 text-success" : "border-border bg-surface-2 text-muted hover:text-foreground",
          )}
        >
          <span className="text-[11px] font-medium uppercase tracking-wide">Buy</span>
          <span className="font-mono text-sm tabular-nums">{formatPrice(ask, digits)}</span>
        </button>
      </div>
      <div className="-mt-1 text-center text-[11px] text-muted">{spread != null ? `Spread ${spread} pts` : "No quote yet"}</div>

      {/* Order type */}
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1" role="group" aria-label="Order type">
        {ORDER_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={orderType === t}
            onClick={() => setOrderType(t)}
            className={clsx("rounded-md py-1 text-[11px] font-medium", orderType === t ? "bg-accent-2/20 text-accent-2" : "text-muted hover:text-foreground")}
          >
            {t.charAt(0) + t.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Volume */}
      <div>
        <label htmlFor="ticket-volume" className="mb-1 block text-xs text-muted">
          Volume (lots)
        </label>
        <div className="flex items-stretch gap-1">
          <button type="button" className="btn-secondary !px-3 !py-1" onClick={() => bumpVolume(-1)} aria-label="Decrease volume">
            −
          </button>
          <input
            id="ticket-volume"
            type="number"
            inputMode="decimal"
            className="input-base text-center font-mono"
            value={volumeText}
            min={instrument?.minVolume}
            max={instrument?.maxVolume}
            step={step}
            onChange={(e) => setVolumeText(e.target.value)}
            onBlur={() => {
              if (instrument && volume != null && !Number.isNaN(volume)) setVolumeText(clampVolume(volume, instrument).toFixed(volDecimals));
            }}
            aria-invalid={Boolean(volumeError)}
            aria-describedby="ticket-volume-help"
          />
          <button type="button" className="btn-secondary !px-3 !py-1" onClick={() => bumpVolume(1)} aria-label="Increase volume">
            +
          </button>
        </div>
        <div id="ticket-volume-help" className={clsx("mt-1 text-[11px]", volumeError ? "text-danger" : "text-muted")}>
          {volumeError ?? (instrument ? `${instrument.minVolume} – ${instrument.maxVolume} lots, step ${instrument.volumeStep}` : "")}
        </div>
      </div>

      {orderType !== "MARKET" && (
        <div>
          <label htmlFor="ticket-price" className="mb-1 block text-xs text-muted">
            {orderType === "LIMIT" ? "Limit price" : "Stop price"}
          </label>
          <input
            id="ticket-price"
            type="number"
            inputMode="decimal"
            className="input-base font-mono"
            value={priceText}
            step={pointSize(digits)}
            placeholder={pricePlaceholder}
            onChange={(e) => setPriceText(e.target.value)}
            aria-invalid={Boolean(priceError)}
          />
          {priceError && <div className="mt-1 text-[11px] text-danger">{priceError}</div>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="ticket-sl" className="mb-1 block text-xs text-muted">
            Stop loss
          </label>
          <input
            id="ticket-sl"
            type="number"
            inputMode="decimal"
            className="input-base font-mono"
            value={slText}
            step={pointSize(digits)}
            placeholder="optional"
            onChange={(e) => setSlText(e.target.value)}
            aria-invalid={Boolean(levels.stopLoss)}
          />
          {levels.stopLoss && <div className="mt-1 text-[11px] text-danger">{levels.stopLoss}</div>}
        </div>
        <div>
          <label htmlFor="ticket-tp" className="mb-1 block text-xs text-muted">
            Take profit
          </label>
          <input
            id="ticket-tp"
            type="number"
            inputMode="decimal"
            className="input-base font-mono"
            value={tpText}
            step={pointSize(digits)}
            placeholder="optional"
            onChange={(e) => setTpText(e.target.value)}
            aria-invalid={Boolean(levels.takeProfit)}
          />
          {levels.takeProfit && <div className="mt-1 text-[11px] text-danger">{levels.takeProfit}</div>}
        </div>
      </div>

      {/* Estimates */}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-surface-2 p-2 text-[11px]">
        <dt className="text-muted">Est. margin</dt>
        <dd className={clsx("text-right font-medium tabular-nums", marginTooHigh && "text-danger")}>
          {marginEstimate != null ? formatCurrency(marginEstimate, estCurrency) : "—"}
        </dd>
        <dt className="text-muted">Pip value</dt>
        <dd className="text-right font-medium tabular-nums">{pipEstimate != null ? formatCurrency(pipEstimate, estCurrency) : "—"}</dd>
        <dt className="text-muted">Commission</dt>
        <dd className="text-right font-medium tabular-nums">{commissionEstimate != null ? etb(commissionEstimate) : "—"}</dd>
        <dt className="text-muted">Free margin</dt>
        <dd className="text-right font-medium tabular-nums">{freeMargin != null ? etb(freeMargin) : "—"}</dd>
        {rate == null && quote !== "ETB" && <dd className="col-span-2 text-[10px] text-muted">Estimates shown in {quote}; no ETB rate available yet.</dd>}
        {marginTooHigh && <dd className="col-span-2 text-[10px] text-danger">Estimated margin exceeds free margin.</dd>}
      </dl>

      <button
        type="submit"
        disabled={!canSubmit}
        className={clsx(
          "w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50",
          side === "BUY" ? "bg-success hover:brightness-110" : "bg-danger hover:brightness-110",
        )}
      >
        {submitting ? "Sending…" : `${side === "BUY" ? "Buy" : "Sell"} ${safeVolume > 0 ? safeVolume.toFixed(volDecimals) : ""} ${symbol}`.trim()}
        {orderType !== "MARKET" ? ` (${orderType.toLowerCase()})` : ""}
      </button>
      {blockReason && (
        <div className="text-center text-[11px] text-warning" role="status">
          {blockReason}
        </div>
      )}
      <div className="text-center text-[10px] text-muted">Press Enter to submit. Fills happen at the server price; estimates are indicative.</div>
    </form>
  );
}
