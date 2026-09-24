import { describe, expect, it } from "vitest";
import { computeDiscount, normalizeCouponCode } from "@/lib/services/coupons";

describe("normalizeCouponCode", () => {
  it("trims and upper-cases input", () => {
    expect(normalizeCouponCode("  welcome10 ")).toBe("WELCOME10");
    expect(normalizeCouponCode("free-trial_2")).toBe("FREE-TRIAL_2");
  });

  it("rejects anything that cannot be a code", () => {
    expect(normalizeCouponCode("")).toBeNull();
    expect(normalizeCouponCode("ab")).toBeNull();
    expect(normalizeCouponCode("WELCOME 10")).toBeNull();
    expect(normalizeCouponCode("X".repeat(33))).toBeNull();
    expect(normalizeCouponCode("DROP;TABLE")).toBeNull();
    expect(normalizeCouponCode(null)).toBeNull();
    expect(normalizeCouponCode(undefined)).toBeNull();
  });
});

describe("computeDiscount", () => {
  it("applies a percentage rounded to cents", () => {
    expect(computeDiscount(2500, { percentOff: 10, amountOff: null })).toBe(250);
    expect(computeDiscount(999.99, { percentOff: 15, amountOff: null })).toBe(150);
    expect(computeDiscount(33.33, { percentOff: 33.3, amountOff: null })).toBe(11.1);
  });

  it("applies a fixed ETB amount", () => {
    expect(computeDiscount(2500, { percentOff: null, amountOff: 300 })).toBe(300);
    expect(computeDiscount(2500, { percentOff: null, amountOff: 0.005 })).toBe(0.01);
  });

  it("never exceeds the price (100% and oversized fixed discounts make it free, not negative)", () => {
    expect(computeDiscount(2500, { percentOff: 100, amountOff: null })).toBe(2500);
    expect(computeDiscount(2500, { percentOff: 150, amountOff: null })).toBe(2500);
    expect(computeDiscount(2500, { percentOff: null, amountOff: 99_999 })).toBe(2500);
  });

  it("is never negative and is zero for a free or invalid price", () => {
    expect(computeDiscount(2500, { percentOff: -10, amountOff: null })).toBe(0);
    expect(computeDiscount(2500, { percentOff: null, amountOff: -50 })).toBe(0);
    expect(computeDiscount(2500, { percentOff: null, amountOff: null })).toBe(0);
    expect(computeDiscount(0, { percentOff: 50, amountOff: null })).toBe(0);
    expect(computeDiscount(Number.NaN, { percentOff: 50, amountOff: null })).toBe(0);
  });

  it("keeps listPrice - discount exact to the cent", () => {
    for (const price of [1, 49.99, 1234.56, 2500, 12_345.67]) {
      for (const percentOff of [1, 7.5, 12.5, 33, 66.6, 99]) {
        const d = computeDiscount(price, { percentOff, amountOff: null });
        expect(Number.isInteger(Math.round(d * 100))).toBe(true);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(price);
      }
    }
  });
});
