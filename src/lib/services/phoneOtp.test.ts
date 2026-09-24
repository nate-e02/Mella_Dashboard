import { describe, expect, it } from "vitest";
import { generateOtpCode, hashOtp, otpMatches, otpMessage } from "@/lib/services/phoneOtp";

describe("OTP code helpers", () => {
  it("generates 6-digit codes, including leading zeros", () => {
    const codes = Array.from({ length: 2000 }, generateOtpCode);
    expect(codes.every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(1900);
  });

  it("binds the hash to purpose, phone and code", () => {
    const h = hashOtp("LOGIN", "+251911234567", "123456");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("123456");
    expect(otpMatches(h, "LOGIN", "+251911234567", "123456")).toBe(true);
    expect(otpMatches(h, "LOGIN", "+251911234567", "123457")).toBe(false);
    expect(otpMatches(h, "SET_PASSWORD", "+251911234567", "123456")).toBe(false);
    expect(otpMatches(h, "LOGIN", "+251911234568", "123456")).toBe(false);
  });

  it("rejects a malformed stored hash instead of throwing", () => {
    expect(otpMatches("abc", "LOGIN", "+251911234567", "123456")).toBe(false);
    expect(otpMatches("", "LOGIN", "+251911234567", "123456")).toBe(false);
  });

  it("writes the SMS in the requested language and ends with the WebOTP line", () => {
    const en = otpMessage("en", "LOGIN", "042917");
    expect(en).toContain("MellaFx code: 042917");
    expect(en.split("\n").at(-1)).toBe(`@${new URL(process.env.APP_URL!).hostname} #042917`);
    const am = otpMessage("am", "LOGIN", "042917");
    expect(am).toContain("042917");
    expect(am).toMatch(/[ሀ-፿]/); // Ge'ez script
    expect(otpMessage("xx", "LOGIN", "042917")).toContain("MellaFx code"); // unknown locale → English
  });
});
