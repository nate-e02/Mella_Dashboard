/**
 * FX trading-session clock. The FX week opens Sunday 17:00 and closes
 * Friday 17:00 America/New_York; the daily rollover is 17:00 New York. All
 * helpers work in New York wall time through Intl (IANA zone data), so they
 * stay correct across both DST transitions without a date library. Pure and
 * client-safe: the engine enforces the holding rules with them and the
 * terminal uses them to explain why an order button is disabled.
 */

export const NEW_YORK = "America/New_York";

/** Minutes after New York midnight. */
const WEEK_OPEN_CLOSE = 17 * 60; // Sunday open / Friday close / daily rollover
const WEEKEND_CUTOFF = 16 * 60 + 45; // no-weekend-holding accounts are flattened here on Friday
const ROLLOVER_CUTOFF = 16 * 60 + 55; // no-overnight accounts are flattened here each weekday

const DAY_MS = 86_400_000;

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; /** 0 = Sunday */ weekday: number };

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NEW_YORK,
  hourCycle: "h23",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** New York wall-clock fields of an instant. */
export function newYorkParts(instant: Date | number): ZonedParts {
  const out: Record<string, string> = {};
  for (const p of formatter.formatToParts(typeof instant === "number" ? instant : instant.getTime())) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday] ?? 0,
  };
}

/** UTC offset of New York at `ms`, in ms (-4h in summer, -5h in winter). */
function offsetAt(ms: number): number {
  const p = newYorkParts(ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant at which New York shows the given wall time. Two passes settle
 * the offset on DST-change days (the times used here, 16:45-17:00, are never
 * inside the 02:00 skipped/repeated hour).
 */
export function newYorkWallTime(year: number, month: number, day: number, hour: number, minute: number): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let t = wall - offsetAt(wall);
  t = wall - offsetAt(t);
  return new Date(t);
}

/** New York calendar date `days` after the given one (calendar arithmetic, DST-agnostic). */
function addDays(p: Pick<ZonedParts, "year" | "month" | "day">, days: number) {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day) + days * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function minutesOf(p: ZonedParts): number {
  return p.hour * 60 + p.minute;
}

/** True from Friday 17:00 until Sunday 17:00 New York: the FX market is closed. */
export function isWeekendClosed(now: Date | number): boolean {
  const p = newYorkParts(now);
  const m = minutesOf(p);
  return (p.weekday === 5 && m >= WEEK_OPEN_CLOSE) || p.weekday === 6 || (p.weekday === 0 && m < WEEK_OPEN_CLOSE);
}

/**
 * Friday 16:45 New York of the FX week `now` belongs to. During the weekend
 * (Friday 17:00 .. Sunday 17:00) that is the Friday that just passed; from
 * the Sunday open it is the coming Friday.
 */
export function weekendCutoff(now: Date | number): Date {
  const p = newYorkParts(now);
  const m = minutesOf(p);
  let delta: number;
  if (p.weekday === 6) delta = -1;
  else if (p.weekday === 0) delta = m < WEEK_OPEN_CLOSE ? -2 : 5;
  else delta = 5 - p.weekday; // Mon..Fri
  const d = addDays(p, delta);
  return newYorkWallTime(d.year, d.month, d.day, Math.floor(WEEKEND_CUTOFF / 60), WEEKEND_CUTOFF % 60);
}

/** Sunday 17:00 New York that ends the weekend following `weekendCutoff(now)`. */
export function weekendReopen(now: Date | number): Date {
  const friday = newYorkParts(weekendCutoff(now));
  const d = addDays(friday, 2);
  return newYorkWallTime(d.year, d.month, d.day, Math.floor(WEEK_OPEN_CLOSE / 60), WEEK_OPEN_CLOSE % 60);
}

/** Friday 16:45 .. Sunday 17:00 New York: accounts without weekend holding may not hold or open FX positions. */
export function isWeekendRestricted(now: Date | number): boolean {
  const t = typeof now === "number" ? now : now.getTime();
  return t >= weekendCutoff(t).getTime() && t < weekendReopen(t).getTime();
}

/** The most recent weekday (Mon-Fri) 16:55 New York at or before `now`. */
export function dailyRolloverCutoff(now: Date | number): Date {
  const t = typeof now === "number" ? now : now.getTime();
  const p = newYorkParts(t);
  for (let back = 0; back < 7; back += 1) {
    const d = addDays(p, -back);
    const weekday = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const cutoff = newYorkWallTime(d.year, d.month, d.day, Math.floor(ROLLOVER_CUTOFF / 60), ROLLOVER_CUTOFF % 60);
    if (cutoff.getTime() <= t) return cutoff;
  }
  /* c8 ignore next */
  throw new Error("unreachable: a weekday 16:55 always exists within 7 days");
}

/** Weekday 16:55 .. 17:00 New York: accounts without overnight holding are flattened and may not open positions. */
export function isRolloverWindow(now: Date | number): boolean {
  const p = newYorkParts(now);
  const m = minutesOf(p);
  return p.weekday >= 1 && p.weekday <= 5 && m >= ROLLOVER_CUTOFF && m < WEEK_OPEN_CLOSE;
}

/** The daily rollover (17:00 New York) that ends the window `dailyRolloverCutoff(now)` opened. */
export function dailyRollover(now: Date | number): Date {
  const cutoff = dailyRolloverCutoff(now);
  return new Date(cutoff.getTime() + (WEEK_OPEN_CLOSE - ROLLOVER_CUTOFF) * 60_000);
}
