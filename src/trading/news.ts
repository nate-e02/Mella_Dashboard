/**
 * News-trading rule, pure and client-safe. An account that may not trade the
 * news cannot open new exposure on an instrument whose base or quote currency
 * is the currency of a HIGH-impact event from W minutes before until W
 * minutes after the release (W = SystemSetting rules.newsWindowMinutes).
 * Closing, SL/TP and reducing risk are always allowed.
 */

export type NewsEvent = { id: string; title: string; currency: string; /** epoch ms */ scheduledAt: number };

export type NewsWindow = { event: NewsEvent; start: number; end: number };

export const DEFAULT_NEWS_WINDOW_MINUTES = 2;
/** SystemSetting holding W (minutes, number). */
export const NEWS_WINDOW_SETTING = "rules.newsWindowMinutes";

/** Accepts a setting value (number or numeric string); anything invalid falls back to the default. 0 disables the window. */
export function normalizeNewsWindowMinutes(value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n) || n < 0) return DEFAULT_NEWS_WINDOW_MINUTES;
  return Math.min(120, n);
}

export function affectsInstrument(event: Pick<NewsEvent, "currency">, inst: { baseCurrency: string; quoteCurrency: string }): boolean {
  const c = event.currency.trim().toUpperCase();
  return c !== "" && (inst.baseCurrency.toUpperCase() === c || inst.quoteCurrency.toUpperCase() === c);
}

export function windowOf(event: NewsEvent, windowMs: number): NewsWindow {
  return { event, start: event.scheduledAt - windowMs, end: event.scheduledAt + windowMs };
}

/**
 * The restricted window covering `now` for this instrument, if any (the one
 * ending last when several overlap, so callers can quote a single end time).
 * Inclusive at both edges: [event - W, event + W].
 */
export function activeNewsWindow(events: readonly NewsEvent[], inst: { baseCurrency: string; quoteCurrency: string }, now: number, windowMs: number): NewsWindow | null {
  if (windowMs <= 0) return null;
  let best: NewsWindow | null = null;
  for (const e of events) {
    if (!affectsInstrument(e, inst)) continue;
    const w = windowOf(e, windowMs);
    if (now < w.start || now > w.end) continue;
    if (!best || w.end > best.end) best = w;
  }
  return best;
}

/** Windows that are active now or start within `horizonMs`, soonest first. */
export function upcomingNewsWindows(events: readonly NewsEvent[], now: number, windowMs: number, horizonMs: number): NewsWindow[] {
  if (windowMs <= 0) return [];
  return events
    .map((e) => windowOf(e, windowMs))
    .filter((w) => w.end >= now && w.start <= now + horizonMs)
    .sort((a, b) => a.start - b.start || a.event.currency.localeCompare(b.event.currency));
}
