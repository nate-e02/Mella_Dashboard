import { describe, expect, it } from "vitest";
import { generateReferralCode, normalizeReferralCode, REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH } from "@/lib/services/referrals";

describe("generateReferralCode", () => {
  it("produces 8 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateReferralCode();
      expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
      for (const ch of code) expect(REFERRAL_CODE_ALPHABET).toContain(ch);
      expect(code).not.toMatch(/[01ILO]/);
      expect(normalizeReferralCode(code)).toBe(code);
    }
  });

  it("rejects biased bytes instead of wrapping them (rejection sampling)", () => {
    // 248..255 would bias the first 8 characters if taken modulo 31.
    const bytes = [255, 250, 248, 0, 1, 2, 3, 4, 5, 6, 7, 30, 30, 30, 30, 30];
    const code = generateReferralCode((n) => Uint8Array.from(bytes.slice(0, n)));
    expect(code).toBe("23456789");
  });

  it("is effectively unique", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => generateReferralCode()));
    expect(seen.size).toBe(2000);
  });
});

describe("normalizeReferralCode", () => {
  it("accepts any case and surrounding whitespace", () => {
    expect(normalizeReferralCode(" abcd2345 ")).toBe("ABCD2345");
  });

  it("rejects malformed codes", () => {
    expect(normalizeReferralCode("ABCD234")).toBeNull();
    expect(normalizeReferralCode("ABCD23456")).toBeNull();
    expect(normalizeReferralCode("ABCD2O45")).toBeNull(); // letter O is not in the alphabet
    expect(normalizeReferralCode("ABCD1345")).toBeNull();
    expect(normalizeReferralCode("<script>")).toBeNull();
    expect(normalizeReferralCode(null)).toBeNull();
  });
});
