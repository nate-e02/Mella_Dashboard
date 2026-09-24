import { describe, expect, it } from "vitest";
import { applyMarkup, checkStops, fillPrice, grossPnlQuote, markPrice, pendingFillPrice, pendingTriggered, requiredMargin, stopExitPrice, validatePendingPrice, validateStops, validateVolume } from "./math";
import { Converter, NoFxPathError } from "./fx";

describe("P&L and margin math", () => {
  it("computes gross P&L in the quote currency from the entry each time", () => {
    // BUY 0.1 lot EURUSD from 1.1000 to 1.1050 = +50 pips * $1/pip/0.1lot... = 0.005 * 10000 = 50 USD
    expect(grossPnlQuote("BUY", 1.1, 1.105, 0.1, 100_000)).toBeCloseTo(50, 8);
    expect(grossPnlQuote("SELL", 1.1, 1.105, 0.1, 100_000)).toBeCloseTo(-50, 8);
    // 1 lot XAUUSD (100 oz) up $10 = $1000
    expect(grossPnlQuote("BUY", 2350, 2360, 1, 100)).toBeCloseTo(1000, 8);
  });

  it("converts quote-currency P&L to ETB through USD, including JPY crosses via USDJPY", () => {
    const fx = new Converter("ETB");
    fx.setUsdRate(125, "MANUAL");
    expect(fx.toAccountCurrency(50, "USD")).toEqual({ amount: 6250, rate: 125 });
    expect(fx.toAccountCurrency(10, "USDT").amount).toBe(1250);
    expect(() => fx.toAccountCurrency(1000, "JPY")).toThrow(NoFxPathError);
    fx.updateMid("USDJPY", 150);
    // 1500 JPY = 10 USD = 1250 ETB
    const jpy = fx.toAccountCurrency(1500, "JPY");
    expect(jpy.amount).toBe(1250);
    expect(jpy.rate).toBeCloseTo(125 / 150, 10);
    fx.updateMid("GBPUSD", 1.25);
    // 100 GBP = 125 USD = 15625 ETB
    expect(fx.toAccountCurrency(100, "GBP").amount).toBe(15625);
    expect(fx.rate("ETB")).toBe(1);
    expect(fx.rate("CHF")).toBeNull();
  });

  it("has no USD->ETB path until a rate is loaded", () => {
    const fx = new Converter("ETB");
    expect(fx.rate("USD")).toBeNull();
    expect(fx.usdRate()).toBeNull();
  });

  it("computes required margin as notional in account currency / leverage", () => {
    // 0.01 lot EURUSD at 1.1001 with USD->ETB 100 and leverage 100 = 1000*1.1001*100/100 = 1100.1 ETB
    expect(requiredMargin(0.01, 100_000, 1.1001, 100, 100)).toBe(1100.1);
    expect(requiredMargin(1, 100, 2350, 125, 50)).toBe(587500);
    expect(requiredMargin(1, 1, 60000, 125, 0)).toBe(7_500_000); // leverage 0 treated as 1
  });

  it("fills BUY at ask, SELL at bid; marks BUY at bid, SELL at ask", () => {
    const q = { bid: 1.1, ask: 1.1002 };
    expect(fillPrice("BUY", q)).toBe(1.1002);
    expect(fillPrice("SELL", q)).toBe(1.1);
    expect(markPrice("BUY", q)).toBe(1.1);
    expect(markPrice("SELL", q)).toBe(1.1002);
  });

  it("applies spread markup half per side, rounded to the instrument digits", () => {
    expect(applyMarkup({ bid: 1.1, ask: 1.1002 }, 2, 5)).toEqual({ bid: 1.09999, ask: 1.10021 });
    expect(applyMarkup({ bid: 1.1, ask: 1.1002 }, 0, 5)).toEqual({ bid: 1.1, ask: 1.1002 });
  });
});

describe("stop-loss / take-profit triggers", () => {
  it("BUY: bid <= SL triggers STOP_LOSS, bid >= TP triggers TAKE_PROFIT", () => {
    expect(checkStops("BUY", { bid: 1.095, ask: 1.0952 }, 1.095, 1.11)).toBe("STOP_LOSS");
    expect(checkStops("BUY", { bid: 1.0951, ask: 1.0953 }, 1.095, 1.11)).toBeNull();
    expect(checkStops("BUY", { bid: 1.11, ask: 1.1102 }, 1.095, 1.11)).toBe("TAKE_PROFIT");
    expect(checkStops("BUY", { bid: 1.1099, ask: 1.1102 }, 1.095, 1.11)).toBeNull(); // ask crossing TP is not enough
  });

  it("SELL: ask >= SL triggers STOP_LOSS, ask <= TP triggers TAKE_PROFIT", () => {
    expect(checkStops("SELL", { bid: 1.1098, ask: 1.11 }, 1.11, 1.09)).toBe("STOP_LOSS");
    expect(checkStops("SELL", { bid: 1.0898, ask: 1.09 }, 1.11, 1.09)).toBe("TAKE_PROFIT");
    expect(checkStops("SELL", { bid: 1.0998, ask: 1.1 }, 1.11, 1.09)).toBeNull();
    expect(checkStops("SELL", { bid: 1.0998, ask: 1.1 }, null, null)).toBeNull();
  });

  it("closes at the stop level itself (no slippage) and prefers SL when both are gapped through", () => {
    expect(stopExitPrice("STOP_LOSS", 1.095, 1.11)).toBe(1.095);
    expect(stopExitPrice("TAKE_PROFIT", 1.095, 1.11)).toBe(1.11);
    expect(checkStops("BUY", { bid: 0.5, ask: 2 }, 1.095, 1.11)).toBe("STOP_LOSS");
  });

  it("validates SL/TP sides for placement", () => {
    expect(validateStops("BUY", 1.1, 1.09, 1.12)).toBeNull();
    expect(validateStops("BUY", 1.1, 1.1, undefined)).toBe("INVALID_STOP_LOSS");
    expect(validateStops("BUY", 1.1, undefined, 1.09)).toBe("INVALID_TAKE_PROFIT");
    expect(validateStops("SELL", 1.1, 1.12, 1.09)).toBeNull();
    expect(validateStops("SELL", 1.1, 1.09, null)).toBe("INVALID_STOP_LOSS");
    expect(validateStops("SELL", 1.1, null, 1.12)).toBe("INVALID_TAKE_PROFIT");
  });
});

describe("pending order triggers", () => {
  const q = { bid: 1.1, ask: 1.1002 };
  it("BUY LIMIT fills when ask <= price, BUY STOP when ask >= price", () => {
    expect(pendingTriggered("BUY", "LIMIT", 1.1002, q)).toBe(true);
    expect(pendingTriggered("BUY", "LIMIT", 1.1001, q)).toBe(false);
    expect(pendingTriggered("BUY", "STOP", 1.1002, q)).toBe(true);
    expect(pendingTriggered("BUY", "STOP", 1.1003, q)).toBe(false);
  });
  it("SELL LIMIT fills when bid >= price, SELL STOP when bid <= price", () => {
    expect(pendingTriggered("SELL", "LIMIT", 1.1, q)).toBe(true);
    expect(pendingTriggered("SELL", "LIMIT", 1.1001, q)).toBe(false);
    expect(pendingTriggered("SELL", "STOP", 1.1, q)).toBe(true);
    expect(pendingTriggered("SELL", "STOP", 1.0999, q)).toBe(false);
  });
  it("LIMIT fills at its price (or better), STOP at the market", () => {
    expect(pendingFillPrice("BUY", "LIMIT", 1.101, q)).toBe(1.1002);
    expect(pendingFillPrice("BUY", "LIMIT", 1.1002, q)).toBe(1.1002);
    expect(pendingFillPrice("SELL", "LIMIT", 1.099, q)).toBe(1.1);
    expect(pendingFillPrice("BUY", "STOP", 1.0999, q)).toBe(1.1002);
  });
  it("rejects pending prices on the wrong side of the market", () => {
    expect(validatePendingPrice("BUY", "LIMIT", 1.1001, q)).toBeNull();
    expect(validatePendingPrice("BUY", "LIMIT", 1.1002, q)).toBe("INVALID_PRICE");
    expect(validatePendingPrice("BUY", "STOP", 1.1003, q)).toBeNull();
    expect(validatePendingPrice("BUY", "STOP", 1.1, q)).toBe("INVALID_PRICE");
    expect(validatePendingPrice("SELL", "LIMIT", 1.1001, q)).toBeNull();
    expect(validatePendingPrice("SELL", "LIMIT", 1.1, q)).toBe("INVALID_PRICE");
    expect(validatePendingPrice("SELL", "STOP", 1.0999, q)).toBeNull();
    expect(validatePendingPrice("SELL", "STOP", undefined, q)).toBe("INVALID_PRICE");
  });
});

describe("volume validation", () => {
  const inst = { minVolume: 0.01, maxVolume: 50, volumeStep: 0.01 };
  it("enforces min/max/step", () => {
    expect(validateVolume(0.01, inst)).toBeNull();
    expect(validateVolume(0.15, inst)).toBeNull();
    expect(validateVolume(50, inst)).toBeNull();
    expect(validateVolume(0.005, inst)).toBe("INVALID_VOLUME");
    expect(validateVolume(50.01, inst)).toBe("INVALID_VOLUME");
    expect(validateVolume(0.015, inst)).toBe("INVALID_VOLUME");
    expect(validateVolume(0, inst)).toBe("INVALID_VOLUME");
    expect(validateVolume(Number.NaN, inst)).toBe("INVALID_VOLUME");
  });
});
