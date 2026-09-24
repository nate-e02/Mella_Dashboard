import { TIMEFRAME_SECONDS, type InstrumentInfo, type OrderKind, type Side, type Timeframe } from "@/trading/protocol";

/**
 * Pure, client-safe helpers for the order ticket and chart. Estimates only:
 * the worker is the source of truth for fills, margin and P&L.
 */

/** Bucket start (unix seconds) for a tick timestamp; mirrors the server's bucketStart. */
export function bucketStartSeconds(tsSeconds: number, tf: Timeframe): number {
  const size = TIMEFRAME_SECONDS[tf];
  return Math.floor(tsSeconds / size) * size;
}

export function pointSize(digits: number): number {
  // Parsed from a literal so server and client produce the identical double
  // (Math.pow(10, -5) is not exact and can serialise differently).
  return Number(`1e-${Math.max(0, Math.trunc(digits))}`);
}

/** A pip is one unit of the second-to-last quoted digit (0.0001 on 5-digit FX, 0.01 on 3-digit JPY pairs). */
export function pipSize(digits: number): number {
  return Number(`1e-${Math.max(1, Math.trunc(digits)) - 1}`);
}

export function spreadPoints(bid: number, ask: number, digits: number): number {
  return Math.max(0, Math.round((ask - bid) / pointSize(digits)));
}

export function formatPrice(price: number | null | undefined, digits: number): string {
  if (price == null || !Number.isFinite(price)) return "—";
  return price.toFixed(digits);
}

export function stepDecimals(step: number): number {
  if (step >= 1) return 0;
  const text = step.toString();
  if (text.includes("e-")) return Number(text.split("e-")[1]);
  return (text.split(".")[1] ?? "").length;
}

export function roundToStep(value: number, step: number): number {
  const decimals = stepDecimals(step);
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

export function clampVolume(value: number, instrument: Pick<InstrumentInfo, "minVolume" | "maxVolume" | "volumeStep">): number {
  if (!Number.isFinite(value)) return instrument.minVolume;
  const stepped = roundToStep(value, instrument.volumeStep);
  return Math.min(instrument.maxVolume, Math.max(instrument.minVolume, stepped));
}

/**
 * Value of one pip for `volume` lots, in the account currency.
 * `quoteToAccountRate` converts the instrument's quote currency (e.g. USD) to
 * the account currency (ETB); pass 1 when they are the same or unknown.
 */
export function pipValue(instrument: Pick<InstrumentInfo, "contractSize" | "digits">, volume: number, quoteToAccountRate = 1): number {
  return volume * instrument.contractSize * pipSize(instrument.digits) * quoteToAccountRate;
}

/** Margin required to open `volume` lots at `price` with `leverage`, in the account currency. */
export function estimateMargin(
  instrument: Pick<InstrumentInfo, "contractSize">,
  volume: number,
  price: number,
  leverage: number,
  quoteToAccountRate = 1,
): number {
  if (!Number.isFinite(price) || price <= 0 || leverage <= 0) return 0;
  return (volume * instrument.contractSize * price * quoteToAccountRate) / leverage;
}

/** Estimated commission for one side of the trade, in the account currency. */
export function estimateCommission(instrument: Pick<InstrumentInfo, "commissionPerLot">, volume: number): number {
  return volume * instrument.commissionPerLot;
}

/** Price at which a market order would fill: buyers pay the ask, sellers receive the bid. */
export function marketFillPrice(side: Side, bid: number, ask: number): number {
  return side === "BUY" ? ask : bid;
}

/**
 * Where a pending order must sit relative to the market:
 * a LIMIT buys below / sells above the current price; a STOP buys above / sells below.
 */
export function validatePendingPrice(input: { orderType: OrderKind; side: Side; price: number | null; bid: number | null; ask: number | null }): string | null {
  if (input.orderType === "MARKET") return null;
  if (input.price == null || !Number.isFinite(input.price) || input.price <= 0) return "Enter the order price";
  if (input.bid == null || input.ask == null) return null; // cannot check without a quote; the server will
  const ref = input.side === "BUY" ? input.ask : input.bid;
  if (input.orderType === "LIMIT") {
    if (input.side === "BUY" && input.price >= ref) return "A buy limit must be below the ask";
    if (input.side === "SELL" && input.price <= ref) return "A sell limit must be above the bid";
  } else {
    if (input.side === "BUY" && input.price <= ref) return "A buy stop must be above the ask";
    if (input.side === "SELL" && input.price >= ref) return "A sell stop must be below the bid";
  }
  return null;
}

/** Stop-loss / take-profit must sit on the losing / winning side of the entry. */
export function validateProtectiveLevels(input: {
  side: Side;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
}): { stopLoss: string | null; takeProfit: string | null } {
  const out = { stopLoss: null as string | null, takeProfit: null as string | null };
  const { side, entry, stopLoss, takeProfit } = input;
  if (stopLoss != null && (!Number.isFinite(stopLoss) || stopLoss <= 0)) out.stopLoss = "Invalid stop loss";
  if (takeProfit != null && (!Number.isFinite(takeProfit) || takeProfit <= 0)) out.takeProfit = "Invalid take profit";
  if (entry == null || !Number.isFinite(entry)) return out;
  if (stopLoss != null && !out.stopLoss) {
    if (side === "BUY" && stopLoss >= entry) out.stopLoss = "Stop loss must be below the entry for a buy";
    if (side === "SELL" && stopLoss <= entry) out.stopLoss = "Stop loss must be above the entry for a sell";
  }
  if (takeProfit != null && !out.takeProfit) {
    if (side === "BUY" && takeProfit <= entry) out.takeProfit = "Take profit must be above the entry for a buy";
    if (side === "SELL" && takeProfit >= entry) out.takeProfit = "Take profit must be below the entry for a sell";
  }
  return out;
}

/** Parses a numeric text field; empty -> null, junk -> NaN so validators can flag it. */
export function parseNumberField(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Signed money with an explicit sign so gains/losses never rely on colour alone. */
export function signed(value: number, formatted: string): string {
  if (value > 0) return `+${formatted}`;
  if (value < 0) return formatted.startsWith("-") ? formatted : `-${formatted}`;
  return formatted;
}

export const CATEGORY_LABEL: Record<InstrumentInfo["category"], string> = {
  FOREX: "FX",
  METAL: "Metals",
  CRYPTO: "Crypto",
  INDEX: "Indices",
};
