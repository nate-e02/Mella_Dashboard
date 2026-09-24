import type { AccountRules } from "@/lib/services/accountState";
import type { InstrumentInfo, MarketNews } from "@/trading/protocol";
import { activeNewsWindow, affectsInstrument, upcomingNewsWindows, type NewsEvent } from "@/trading/news";
import { dailyRollover, dailyRolloverCutoff, isRolloverWindow, isWeekendRestricted, weekendCutoff, weekendReopen } from "@/trading/sessions";

/**
 * Client mirror of the engine's rule checks (src/trading/engine.ts
 * ruleRestriction), so the terminal can explain a disabled button and warn
 * ahead of time. The server remains the authority: it re-checks every order.
 */

export type RuleRestriction =
  | { code: "WEEKEND_CLOSED"; until: number }
  | { code: "OVERNIGHT_CLOSED"; until: number }
  | { code: "NEWS_WINDOW"; until: number; event: NewsEvent };

export function ruleRestriction(rules: AccountRules, inst: InstrumentInfo, news: MarketNews | null | undefined, now: number): RuleRestriction | null {
  if (inst.category !== "CRYPTO") {
    if (!rules.weekendHoldingAllowed && isWeekendRestricted(now)) return { code: "WEEKEND_CLOSED", until: weekendReopen(now).getTime() };
    if (!rules.overnightHoldingAllowed && isRolloverWindow(now)) return { code: "OVERNIGHT_CLOSED", until: dailyRollover(now).getTime() };
  }
  if (!rules.newsTradingAllowed && news) {
    const w = activeNewsWindow(news.events, inst, now, news.windowMinutes * 60_000);
    if (w) return { code: "NEWS_WINDOW", until: w.end, event: w.event };
  }
  return null;
}

export type RuleNotice =
  | { kind: "news"; active: boolean; event: NewsEvent; start: number; end: number; symbols: string[] }
  | { kind: "weekend"; active: boolean; cutoff: number; reopen: number }
  | { kind: "overnight"; active: boolean; cutoff: number; rollover: number };

const NEWS_HEADS_UP_MS = 60 * 60_000;
const WEEKEND_HEADS_UP_MS = 3 * 60 * 60_000;
const OVERNIGHT_HEADS_UP_MS = 60 * 60_000;

/**
 * Banners for the account's restrictive rules: news windows that are open or
 * start within the hour (listing affected symbols, `preferred` first), and
 * the weekend / rollover flattening when it is close or in force.
 */
export function ruleNotices(rules: AccountRules, instruments: readonly InstrumentInfo[], news: MarketNews | null | undefined, now: number, preferred?: string): RuleNotice[] {
  const out: RuleNotice[] = [];
  if (!rules.weekendHoldingAllowed) {
    const cutoff = weekendCutoff(now).getTime();
    const active = isWeekendRestricted(now);
    if (active || (cutoff > now && cutoff - now <= WEEKEND_HEADS_UP_MS)) out.push({ kind: "weekend", active, cutoff, reopen: weekendReopen(now).getTime() });
  }
  if (!rules.overnightHoldingAllowed && !(out[0]?.kind === "weekend" && out[0].active)) {
    if (isRolloverWindow(now)) {
      out.push({ kind: "overnight", active: true, cutoff: dailyRolloverCutoff(now).getTime(), rollover: dailyRollover(now).getTime() });
    } else {
      const next = dailyRolloverCutoff(now + OVERNIGHT_HEADS_UP_MS).getTime();
      if (next > now) out.push({ kind: "overnight", active: false, cutoff: next, rollover: dailyRollover(next).getTime() });
    }
  }
  if (!rules.newsTradingAllowed && news) {
    for (const w of upcomingNewsWindows(news.events, now, news.windowMinutes * 60_000, NEWS_HEADS_UP_MS)) {
      const symbols = instruments.filter((i) => affectsInstrument(w.event, i)).map((i) => i.symbol);
      if (symbols.length === 0) continue;
      if (preferred && symbols.includes(preferred)) symbols.sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : 0));
      out.push({ kind: "news", active: now >= w.start, event: w.event, start: w.start, end: w.end, symbols });
    }
  }
  return out;
}
