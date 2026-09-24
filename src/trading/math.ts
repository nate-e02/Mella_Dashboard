import { roundCurrency } from "@/lib/services/calculations";
import type { OrderKind, Side } from "@/trading/protocol";

/**
 * Pure trading arithmetic shared by the engine and its unit tests. Nothing
 * here touches the database or the clock. All prices are quote-currency
 * numbers; conversion to the account currency happens in fx.ts.
 */

export type Quote = { bid: number; ask: number };

export const direction = (side: Side): 1 | -1 => (side === "BUY" ? 1 : -1);

export function roundPrice(price: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(price * scale) / scale;
}

/** Price a MARKET order fills at: BUY lifts the ask, SELL hits the bid. */
export function fillPrice(side: Side, q: Quote): number {
  return side === "BUY" ? q.ask : q.bid;
}

/** Price an open position is valued (and closed) at: BUY exits on the bid, SELL on the ask. */
export function markPrice(side: Side, q: Quote): number {
  return side === "BUY" ? q.bid : q.ask;
}

/** Widens the raw feed quote by `markupPoints` (1 point = 10^-digits), half on each side. */
export function applyMarkup(q: Quote, markupPoints: number, digits: number): Quote {
  if (!markupPoints || markupPoints <= 0) return { bid: q.bid, ask: q.ask };
  const half = (markupPoints / 2) * 10 ** -digits;
  return { bid: roundPrice(Math.max(0, q.bid - half), digits), ask: roundPrice(q.ask + half, digits) };
}

/** Gross P&L in the QUOTE currency, recomputed from the entry every time (never accumulated). */
export function grossPnlQuote(side: Side, entryPrice: number, exitPrice: number, volume: number, contractSize: number): number {
  return (exitPrice - entryPrice) * volume * contractSize * direction(side);
}

/** Notional value of a position in the quote currency. */
export function notionalQuote(volume: number, contractSize: number, price: number): number {
  return volume * contractSize * price;
}

/** Required margin in the account currency (notional converted, divided by leverage). */
export function requiredMargin(volume: number, contractSize: number, price: number, quoteToAccountRate: number, leverage: number): number {
  const lev = leverage > 0 ? leverage : 1;
  return roundCurrency((notionalQuote(volume, contractSize, price) * quoteToAccountRate) / lev);
}

export type StopTrigger = "STOP_LOSS" | "TAKE_PROFIT" | null;

/**
 * BUY: bid <= SL -> STOP_LOSS, bid >= TP -> TAKE_PROFIT.
 * SELL: ask >= SL -> STOP_LOSS, ask <= TP -> TAKE_PROFIT.
 * If both are hit on the same tick (gap), the stop-loss wins (conservative for the firm).
 */
export function checkStops(side: Side, q: Quote, stopLoss: number | null, takeProfit: number | null): StopTrigger {
  const mark = markPrice(side, q);
  if (side === "BUY") {
    if (stopLoss != null && mark <= stopLoss) return "STOP_LOSS";
    if (takeProfit != null && mark >= takeProfit) return "TAKE_PROFIT";
  } else {
    if (stopLoss != null && mark >= stopLoss) return "STOP_LOSS";
    if (takeProfit != null && mark <= takeProfit) return "TAKE_PROFIT";
  }
  return null;
}

/** Price a triggered stop closes at: the stop level itself (no slippage against the trader). */
export function stopExitPrice(trigger: Exclude<StopTrigger, null>, stopLoss: number | null, takeProfit: number | null): number {
  return trigger === "STOP_LOSS" ? (stopLoss as number) : (takeProfit as number);
}

/**
 * BUY LIMIT fills when ask <= price; BUY STOP when ask >= price;
 * SELL LIMIT when bid >= price; SELL STOP when bid <= price.
 */
export function pendingTriggered(side: Side, type: OrderKind, price: number, q: Quote): boolean {
  if (type === "MARKET") return true;
  if (side === "BUY") return type === "LIMIT" ? q.ask <= price : q.ask >= price;
  return type === "LIMIT" ? q.bid >= price : q.bid <= price;
}

/** A LIMIT fills at its own price (or better is not modelled); a STOP fills at the market. */
export function pendingFillPrice(side: Side, type: OrderKind, price: number, q: Quote): number {
  if (type === "LIMIT") return side === "BUY" ? Math.min(price, q.ask) : Math.max(price, q.bid);
  return fillPrice(side, q);
}

export type RejectCode =
  | "INVALID_VOLUME"
  | "INVALID_PRICE"
  | "INVALID_STOP_LOSS"
  | "INVALID_TAKE_PROFIT"
  | "MAX_POSITIONS"
  | "MAX_POSITION_SIZE"
  | "INSUFFICIENT_MARGIN"
  | "NO_FX_PATH"
  | "MARKET_HALTED"
  | "UNKNOWN_SYMBOL"
  | "ACCOUNT_NOT_TRADABLE"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INTERNAL";

export function validateVolume(volume: number, inst: { minVolume: number; maxVolume: number; volumeStep: number }): RejectCode | null {
  if (!Number.isFinite(volume) || volume <= 0) return "INVALID_VOLUME";
  if (volume < inst.minVolume - 1e-9 || volume > inst.maxVolume + 1e-9) return "INVALID_VOLUME";
  const step = inst.volumeStep > 0 ? inst.volumeStep : 0.01;
  const steps = volume / step;
  if (Math.abs(steps - Math.round(steps)) > 1e-6) return "INVALID_VOLUME";
  return null;
}

/** SL must be on the losing side of `reference`, TP on the winning side. */
export function validateStops(side: Side, reference: number, stopLoss: number | null | undefined, takeProfit: number | null | undefined): RejectCode | null {
  if (stopLoss != null) {
    if (!Number.isFinite(stopLoss) || stopLoss <= 0) return "INVALID_STOP_LOSS";
    if (side === "BUY" ? stopLoss >= reference : stopLoss <= reference) return "INVALID_STOP_LOSS";
  }
  if (takeProfit != null) {
    if (!Number.isFinite(takeProfit) || takeProfit <= 0) return "INVALID_TAKE_PROFIT";
    if (side === "BUY" ? takeProfit <= reference : takeProfit >= reference) return "INVALID_TAKE_PROFIT";
  }
  return null;
}

/** A pending order's price must be on the correct side of the current market. */
export function validatePendingPrice(side: Side, type: OrderKind, price: number | undefined, q: Quote): RejectCode | null {
  if (price == null || !Number.isFinite(price) || price <= 0) return "INVALID_PRICE";
  if (side === "BUY") {
    if (type === "LIMIT" && price >= q.ask) return "INVALID_PRICE";
    if (type === "STOP" && price <= q.ask) return "INVALID_PRICE";
  } else {
    if (type === "LIMIT" && price <= q.bid) return "INVALID_PRICE";
    if (type === "STOP" && price >= q.bid) return "INVALID_PRICE";
  }
  return null;
}

export function roundVolume(v: number): number {
  return Math.round(v * 100) / 100;
}
