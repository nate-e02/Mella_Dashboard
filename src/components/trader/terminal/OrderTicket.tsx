"use client";

import { useMemo, useState, type FormEvent } from "react";
import { clsx } from "clsx";
import { useT } from "@/i18n/client";
import { formatCurrency } from "@/lib/format";
import type { AccountMeta } from "@/lib/services/accountState";
import type { MarketStatus, SocketStatus } from "@/lib/hooks/useTradingSocket";
import type { AccountState, InstrumentInfo, OrderKind, Side, Tick } from "@/trading/protocol";
import { etb } from "@/components/trader/dashboard/money";
import { eatTime, phaseLabel, rejectMessage } from "./messages";
import type { RuleRestriction } from "./rules";
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
const ORDER_TYPE_KEYS = { MARKET: "trading.orderType.MARKET", LIMIT: "trading.orderType.LIMIT", STOP: "trading.orderType.STOP" } as const;

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
  restriction,
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
  /** A challenge rule (weekend, rollover, news window) that currently blocks new orders on this instrument. */
  restriction: RuleRestriction | null;
  onPlaceOrder: (draft: OrderDraft) => Promise<void>;
}) {
  const t = useT();
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
    if (!instrument) return t("trading.ticket.noInstrument");
    if (volume == null || Number.isNaN(volume) || volume <= 0) return t("trading.ticket.enterVolume");
    if (volume < instrument.minVolume) return t("trading.ticket.minVolume", { min: instrument.minVolume });
    if (volume > instrument.maxVolume) return t("trading.ticket.maxVolume", { max: instrument.maxVolume });
    if (Math.abs(roundToStep(volume, instrument.volumeStep) - volume) > 1e-9) return t("trading.ticket.volumeStep", { step: instrument.volumeStep });
    return null;
  }, [instrument, volume, t]);

  const priceErrorKey = validatePendingPrice({ orderType, side, price: Number.isNaN(price) ? Number.NaN : price, bid, ask });
  const levels = validateProtectiveLevels({
    side,
    entry: referencePrice != null && !Number.isNaN(referencePrice) ? referencePrice : null,
    stopLoss: Number.isNaN(stopLoss) ? Number.NaN : stopLoss,
    takeProfit: Number.isNaN(takeProfit) ? Number.NaN : takeProfit,
  });

  const halted = marketState?.state === "HALTED";
  const offline = socketStatus !== "open";
  const noQuote = orderType === "MARKET" && (bid == null || ask == null);

  const priceError = priceErrorKey ? t(priceErrorKey) : null;
  const stopLossError = levels.stopLoss ? t(levels.stopLoss) : null;
  const takeProfitError = levels.takeProfit ? t(levels.takeProfit) : null;

  const ruleBlock = restriction
    ? restriction.code === "NEWS_WINDOW"
      ? t("trading.ticket.blockNews", { currency: restriction.event.currency, until: eatTime(restriction.until) })
      : `${rejectMessage(t, restriction.code)} (${t("trading.ticket.until", { time: eatTime(restriction.until) })})`
    : null;

  const blockReason = offline
    ? socketStatus === "connecting"
      ? t("trading.ticket.connecting")
      : t("trading.ticket.disconnected")
    : halted
      ? marketState?.reason
        ? t("trading.ticket.haltedReason", { reason: marketState.reason })
        : t("trading.ticket.halted")
      : !account.tradable
        ? t("trading.ticket.notTradable")
        : ruleBlock
          ? ruleBlock
          : noQuote
            ? t("trading.ticket.waitingPrice")
            : null;

  const validationError = volumeError ?? priceError ?? stopLossError ?? takeProfitError;
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
    <form className="card flex flex-col gap-3 p-3" onSubmit={handleSubmit} aria-label={t("trading.ticket.aria")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("trading.ticket.title")}</h2>
        <label className="sr-only" htmlFor="ticket-account">
          {t("trading.ticket.account")}
        </label>
        <select id="ticket-account" className="input-base !w-auto max-w-[60%] !py-1 text-xs" value={account.id} onChange={(e) => onAccountChange(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {phaseLabel(t, a.phase)}
            </option>
          ))}
        </select>
      </div>

      {/* Side toggles with live prices */}
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("trading.ticket.side")}>
        <button
          type="button"
          aria-pressed={side === "SELL"}
          onClick={() => setSide("SELL")}
          className={clsx(
            "flex flex-col items-center rounded-lg border px-2 py-2 transition",
            side === "SELL" ? "border-danger/60 bg-danger/20 text-danger" : "border-border bg-surface-2 text-muted hover:text-foreground",
          )}
        >
          <span className="text-[11px] font-medium uppercase tracking-wide">{t("trading.ticket.sell")}</span>
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
          <span className="text-[11px] font-medium uppercase tracking-wide">{t("trading.ticket.buy")}</span>
          <span className="font-mono text-sm tabular-nums">{formatPrice(ask, digits)}</span>
        </button>
      </div>
      <div className="-mt-1 text-center text-[11px] text-muted">{spread != null ? t("trading.ticket.spread", { points: spread }) : t("trading.ticket.noQuote")}</div>

      {/* Order type */}
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1" role="group" aria-label={t("trading.ticket.orderType")}>
        {ORDER_TYPES.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={orderType === k}
            onClick={() => setOrderType(k)}
            className={clsx("rounded-md py-1 text-[11px] font-medium", orderType === k ? "bg-accent-2/20 text-accent-2" : "text-muted hover:text-foreground")}
          >
            {t(ORDER_TYPE_KEYS[k])}
          </button>
        ))}
      </div>

      {/* Volume */}
      <div>
        <label htmlFor="ticket-volume" className="mb-1 block text-xs text-muted">
          {t("trading.ticket.volume")}
        </label>
        <div className="flex items-stretch gap-1">
          <button type="button" className="btn-secondary !px-3 !py-1" onClick={() => bumpVolume(-1)} aria-label={t("trading.ticket.decrease")}>
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
          <button type="button" className="btn-secondary !px-3 !py-1" onClick={() => bumpVolume(1)} aria-label={t("trading.ticket.increase")}>
            +
          </button>
        </div>
        <div id="ticket-volume-help" className={clsx("mt-1 text-[11px]", volumeError ? "text-danger" : "text-muted")}>
          {volumeError ?? (instrument ? t("trading.ticket.volumeHelp", { min: instrument.minVolume, max: instrument.maxVolume, step: instrument.volumeStep }) : "")}
        </div>
      </div>

      {orderType !== "MARKET" && (
        <div>
          <label htmlFor="ticket-price" className="mb-1 block text-xs text-muted">
            {orderType === "LIMIT" ? t("trading.ticket.limitPrice") : t("trading.ticket.stopPrice")}
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
            {t("trading.stopLoss")}
          </label>
          <input
            id="ticket-sl"
            type="number"
            inputMode="decimal"
            className="input-base font-mono"
            value={slText}
            step={pointSize(digits)}
            placeholder={t("trading.ticket.optional")}
            onChange={(e) => setSlText(e.target.value)}
            aria-invalid={Boolean(stopLossError)}
          />
          {stopLossError && <div className="mt-1 text-[11px] text-danger">{stopLossError}</div>}
        </div>
        <div>
          <label htmlFor="ticket-tp" className="mb-1 block text-xs text-muted">
            {t("trading.takeProfit")}
          </label>
          <input
            id="ticket-tp"
            type="number"
            inputMode="decimal"
            className="input-base font-mono"
            value={tpText}
            step={pointSize(digits)}
            placeholder={t("trading.ticket.optional")}
            onChange={(e) => setTpText(e.target.value)}
            aria-invalid={Boolean(takeProfitError)}
          />
          {takeProfitError && <div className="mt-1 text-[11px] text-danger">{takeProfitError}</div>}
        </div>
      </div>

      {/* Estimates */}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-surface-2 p-2 text-[11px]">
        <dt className="text-muted">{t("trading.ticket.estMargin")}</dt>
        <dd className={clsx("text-right font-medium tabular-nums", marginTooHigh && "text-danger")}>
          {marginEstimate != null ? formatCurrency(marginEstimate, estCurrency) : "—"}
        </dd>
        <dt className="text-muted">{t("trading.ticket.pipValue")}</dt>
        <dd className="text-right font-medium tabular-nums">{pipEstimate != null ? formatCurrency(pipEstimate, estCurrency) : "—"}</dd>
        <dt className="text-muted">{t("trading.ticket.commission")}</dt>
        <dd className="text-right font-medium tabular-nums">{commissionEstimate != null ? etb(commissionEstimate) : "—"}</dd>
        <dt className="text-muted">{t("trading.freeMargin")}</dt>
        <dd className="text-right font-medium tabular-nums">{freeMargin != null ? etb(freeMargin) : "—"}</dd>
        {rate == null && quote !== "ETB" && <dd className="col-span-2 text-[10px] text-muted">{t("trading.ticket.estimatesIn", { currency: quote })}</dd>}
        {marginTooHigh && <dd className="col-span-2 text-[10px] text-danger">{t("trading.ticket.marginTooHigh")}</dd>}
      </dl>

      <button
        type="submit"
        disabled={!canSubmit}
        className={clsx(
          "w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50",
          side === "BUY" ? "bg-success hover:brightness-110" : "bg-danger hover:brightness-110",
        )}
      >
        {submitting
          ? t("trading.ticket.sending")
          : `${side === "BUY" ? t("trading.ticket.buy") : t("trading.ticket.sell")} ${safeVolume > 0 ? safeVolume.toFixed(volDecimals) : ""} ${symbol}`.replace(/\s+/g, " ").trim()}
        {orderType !== "MARKET" ? ` (${t(ORDER_TYPE_KEYS[orderType])})` : ""}
      </button>
      {blockReason && (
        <div className="text-center text-[11px] text-warning" role="status">
          {blockReason}
        </div>
      )}
      <div className="text-center text-[10px] text-muted">{t("trading.ticket.footer")}</div>
    </form>
  );
}
