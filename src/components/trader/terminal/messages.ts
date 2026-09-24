import type { MessageKey } from "@/i18n/messages";

/**
 * Human text for engine reject/error codes and close reasons. Codes come from
 * RejectCode (src/trading/math.ts), gateway/engine error frames and the
 * reasons attached to cancelled pending orders.
 */

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

const REJECT: Record<string, MessageKey> = {
  INVALID_VOLUME: "trading.reject.INVALID_VOLUME",
  INVALID_PRICE: "trading.reject.INVALID_PRICE",
  INVALID_STOP_LOSS: "trading.reject.INVALID_STOP_LOSS",
  INVALID_TAKE_PROFIT: "trading.reject.INVALID_TAKE_PROFIT",
  MAX_POSITIONS: "trading.reject.MAX_POSITIONS",
  MAX_POSITION_SIZE: "trading.reject.MAX_POSITION_SIZE",
  INSUFFICIENT_MARGIN: "trading.reject.INSUFFICIENT_MARGIN",
  NO_FX_PATH: "trading.reject.NO_FX_PATH",
  MARKET_HALTED: "trading.reject.MARKET_HALTED",
  WEEKEND_CLOSED: "trading.reject.WEEKEND_CLOSED",
  OVERNIGHT_CLOSED: "trading.reject.OVERNIGHT_CLOSED",
  NEWS_WINDOW: "trading.reject.NEWS_WINDOW",
  UNKNOWN_SYMBOL: "trading.reject.UNKNOWN_SYMBOL",
  ACCOUNT_NOT_TRADABLE: "trading.reject.ACCOUNT_NOT_TRADABLE",
  FORBIDDEN: "trading.reject.FORBIDDEN",
  NOT_FOUND: "trading.reject.NOT_FOUND",
  INTERNAL: "trading.reject.INTERNAL",
  CONFLICT: "trading.reject.CONFLICT",
  RATE_LIMITED: "trading.reject.RATE_LIMITED",
  BAD_REQUEST: "trading.reject.BAD_REQUEST",
  BAD_JSON: "trading.reject.BAD_REQUEST",
  UNAUTHORIZED: "trading.reject.UNAUTHORIZED",
  TIMEOUT: "trading.reject.TIMEOUT",
};

/** Message for a reject/error code; `fallback` (the server's English text) is used for codes we do not know. */
export function rejectMessage(t: T, code: string | undefined | null, fallback?: string): string {
  if (!code) return fallback || t("trading.reject.unknown", { code: "?" });
  const key = REJECT[code];
  if (key) return t(key);
  // Pending orders cancelled because the account left trading (ACCOUNT_FAILED, ACCOUNT_PASSED, ...).
  if (code.startsWith("ACCOUNT_")) return t("trading.reject.ACCOUNT_NOT_TRADABLE");
  return fallback || t("trading.reject.unknown", { code });
}

const CLOSE: Record<string, MessageKey> = {
  MANUAL: "trading.closeReason.MANUAL",
  STOP_LOSS: "trading.closeReason.STOP_LOSS",
  TAKE_PROFIT: "trading.closeReason.TAKE_PROFIT",
  BREACH: "trading.closeReason.BREACH",
  ADMIN: "trading.closeReason.ADMIN",
  STOP_OUT: "trading.closeReason.STOP_OUT",
  EXPIRED: "trading.closeReason.EXPIRED",
  WEEKEND: "trading.closeReason.WEEKEND",
  OVERNIGHT: "trading.closeReason.OVERNIGHT",
  NEWS: "trading.closeReason.NEWS",
};

export function closeReasonLabel(t: T, reason: string): string {
  const key = CLOSE[reason];
  return key ? t(key) : reason.replace(/_/g, " ").toLowerCase();
}

/** Rule-driven closes get a highlighted label in the history lists. */
export function isRuleClose(reason: string | null | undefined): boolean {
  return reason === "WEEKEND" || reason === "OVERNIGHT" || reason === "NEWS" || reason === "BREACH";
}

const FAILURE: Record<string, MessageKey> = {
  MAX_DRAWDOWN: "trading.failure.MAX_DRAWDOWN",
  DAILY_LOSS: "trading.failure.DAILY_LOSS",
  EXPIRED: "trading.failure.EXPIRED",
  ADMIN: "trading.failure.ADMIN",
  PURCHASE_REFUNDED: "trading.failure.PURCHASE_REFUNDED",
};

export function failureLabel(t: T, reason: string): string {
  const key = FAILURE[reason];
  return key ? t(key) : reason.replace(/_/g, " ").toLowerCase();
}

export const PHASE_KEYS: Record<string, MessageKey> = { PHASE_1: "trading.phase.PHASE_1", PHASE_2: "trading.phase.PHASE_2", FUNDED: "trading.phase.FUNDED" };

export function phaseLabel(t: T, phase: string): string {
  const key = PHASE_KEYS[phase];
  return key ? t(key) : phase.replace(/_/g, " ");
}

/** "23:45" in East Africa Time. */
export function eatTime(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Addis_Ababa", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);
}

/** Localised weekday + time in EAT, e.g. "Friday 23:45" / "ዓርብ 23:45". */
export function eatDayTime(ms: number, locale: string): string {
  let day: string;
  try {
    day = new Intl.DateTimeFormat(locale, { timeZone: "Africa/Addis_Ababa", weekday: "long" }).format(ms);
  } catch {
    day = new Intl.DateTimeFormat("en", { timeZone: "Africa/Addis_Ababa", weekday: "long" }).format(ms);
  }
  return `${day} ${eatTime(ms)}`;
}
