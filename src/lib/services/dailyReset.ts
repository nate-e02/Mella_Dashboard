/**
 * Daily-loss reset boundary helpers.
 *
 * A challenge's `dailyLossResetTime` snapshot field is a string such as
 * "00:00 EAT", "00:00 UTC" or "21:00 +03:00". The daily loss limit is
 * measured from the account equity captured at the most recent boundary.
 * Everything here is pure so it can be unit-tested without a database.
 */

export type ResetTime = { hour: number; minute: number; offsetMinutes: number };

const NAMED_ZONES: Record<string, number> = {
  UTC: 0,
  GMT: 0,
  EAT: 3 * 60, // East Africa Time (Addis Ababa), no DST
  CET: 60,
  EET: 120,
};

export const DEFAULT_RESET_TIME = "00:00 EAT";

/** Parses "HH:MM ZONE" where ZONE is UTC/EAT/... or ±HH:MM. Falls back to 00:00 EAT. */
export function parseResetTime(input: string | null | undefined): ResetTime {
  const text = (input ?? DEFAULT_RESET_TIME).trim();
  const match = text.match(/^(\d{1,2}):(\d{2})\s*([A-Za-z]+|[+-]\d{2}:?\d{2})?$/);
  if (!match) return parseResetTime(DEFAULT_RESET_TIME);

  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  const zone = match[3] ?? "EAT";

  let offsetMinutes: number;
  if (/^[+-]/.test(zone)) {
    const sign = zone.startsWith("-") ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || 0));
  } else {
    offsetMinutes = NAMED_ZONES[zone.toUpperCase()] ?? NAMED_ZONES.EAT;
  }
  return { hour, minute, offsetMinutes };
}

/** The most recent reset boundary at or before `now`, as an absolute instant. */
export function currentDayStart(resetTime: ResetTime, now: Date = new Date()): Date {
  // Shift into the zone's local clock, take the boundary for that local day,
  // then shift back.
  const shifted = new Date(now.getTime() + resetTime.offsetMinutes * 60_000);
  const boundary = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    resetTime.hour,
    resetTime.minute,
    0,
    0,
  );
  let boundaryInstant = boundary - resetTime.offsetMinutes * 60_000;
  if (boundaryInstant > now.getTime()) boundaryInstant -= 24 * 60 * 60_000;
  return new Date(boundaryInstant);
}

/** The next reset boundary strictly after `now`. */
export function nextDayStart(resetTime: ResetTime, now: Date = new Date()): Date {
  return new Date(currentDayStart(resetTime, now).getTime() + 24 * 60 * 60_000);
}

/** True when the stored anchor predates the current day's boundary, i.e. a new trading day has begun. */
export function needsDailyReset(anchorDate: Date, resetTime: ResetTime, now: Date = new Date()): boolean {
  return anchorDate.getTime() < currentDayStart(resetTime, now).getTime();
}

/** Calendar-day key (YYYY-MM-DD) of an instant in the reset zone, for counting trading days. */
export function tradingDayKey(instant: Date, resetTime: ResetTime): string {
  const shifted = new Date(instant.getTime() + resetTime.offsetMinutes * 60_000 - (resetTime.hour * 60 + resetTime.minute) * 60_000);
  return shifted.toISOString().slice(0, 10);
}
