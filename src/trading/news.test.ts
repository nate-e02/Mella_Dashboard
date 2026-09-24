import { describe, expect, it } from "vitest";
import { activeNewsWindow, affectsInstrument, normalizeNewsWindowMinutes, upcomingNewsWindows, type NewsEvent } from "./news";

const T = Date.UTC(2026, 8, 25, 12, 30); // 12:30Z = 15:30 EAT
const nfp: NewsEvent = { id: "nfp", title: "Non-Farm Payrolls", currency: "USD", scheduledAt: T };
const ecb: NewsEvent = { id: "ecb", title: "ECB rate decision", currency: "eur", scheduledAt: T + 60_000 };
const W = 2 * 60_000;
const EURUSD = { baseCurrency: "EUR", quoteCurrency: "USD" };
const USDJPY = { baseCurrency: "USD", quoteCurrency: "JPY" };
const GBPJPY = { baseCurrency: "GBP", quoteCurrency: "JPY" };
const XAUUSD = { baseCurrency: "XAU", quoteCurrency: "USD" };

describe("news window matcher", () => {
  it("matches the event currency against base or quote, case-insensitively", () => {
    expect(affectsInstrument(nfp, EURUSD)).toBe(true);
    expect(affectsInstrument(nfp, USDJPY)).toBe(true);
    expect(affectsInstrument(nfp, XAUUSD)).toBe(true);
    expect(affectsInstrument(nfp, GBPJPY)).toBe(false);
    expect(affectsInstrument(ecb, EURUSD)).toBe(true);
    expect(affectsInstrument({ currency: " " }, EURUSD)).toBe(false);
  });

  it("is active from event - W to event + W inclusive", () => {
    expect(activeNewsWindow([nfp], EURUSD, T - W - 1, W)).toBeNull();
    expect(activeNewsWindow([nfp], EURUSD, T - W, W)?.event.id).toBe("nfp");
    expect(activeNewsWindow([nfp], EURUSD, T, W)?.event.id).toBe("nfp");
    expect(activeNewsWindow([nfp], EURUSD, T + W, W)?.event.id).toBe("nfp");
    expect(activeNewsWindow([nfp], EURUSD, T + W + 1, W)).toBeNull();
    expect(activeNewsWindow([nfp], GBPJPY, T, W)).toBeNull();
  });

  it("reports the window that ends last when events overlap, and a zero window disables the rule", () => {
    const w = activeNewsWindow([nfp, ecb], EURUSD, T + 30_000, W)!;
    expect(w.event.id).toBe("ecb");
    expect(w.end).toBe(T + 60_000 + W);
    expect(activeNewsWindow([nfp], EURUSD, T, 0)).toBeNull();
  });

  it("lists active and upcoming windows soonest first", () => {
    const later: NewsEvent = { id: "cpi", title: "CPI", currency: "USD", scheduledAt: T + 3 * 3_600_000 };
    expect(upcomingNewsWindows([later, ecb, nfp], T - 10 * 60_000, W, 3_600_000).map((w) => w.event.id)).toEqual(["nfp", "ecb"]);
    expect(upcomingNewsWindows([later, ecb, nfp], T + W + 30_000, W, 6 * 3_600_000).map((w) => w.event.id)).toEqual(["ecb", "cpi"]);
  });

  it("normalises the window setting", () => {
    expect(normalizeNewsWindowMinutes(undefined)).toBe(2);
    expect(normalizeNewsWindowMinutes("5")).toBe(5);
    expect(normalizeNewsWindowMinutes(0)).toBe(0);
    expect(normalizeNewsWindowMinutes(-1)).toBe(2);
    expect(normalizeNewsWindowMinutes({ minutes: 3 })).toBe(2);
  });
});
