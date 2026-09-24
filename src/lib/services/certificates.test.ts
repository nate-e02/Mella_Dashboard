import { describe, expect, it } from "vitest";
import { CERTIFICATE_PUBLIC_ID_PATTERN, certificateDedupeKey, certificateTitle, generateCertificatePublicId } from "@/lib/services/certificates";

describe("generateCertificatePublicId", () => {
  it("produces 12 lower-case base32 characters", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const id = generateCertificatePublicId();
      expect(id).toMatch(CERTIFICATE_PUBLIC_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(500);
  });
});

describe("certificateTitle", () => {
  it("describes a passed phase with account size and program", () => {
    expect(certificateTitle("CHALLENGE_PASSED", { phase: "PHASE_1", accountSize: 1_000_000, program: "Standard 2-Step" })).toBe(
      "Phase 1 Passed — 1,000,000 ETB Standard 2-Step",
    );
  });

  it("describes funding and payouts", () => {
    expect(certificateTitle("FUNDED", { phase: "FUNDED", accountSize: 250_000, program: "Rapid 1-Step" })).toBe("Funded Trader — 250,000 ETB Rapid 1-Step");
    expect(certificateTitle("PAYOUT", {}, 25_000)).toBe("Payout — 25,000 ETB");
  });
});

describe("certificateDedupeKey", () => {
  it("keys account achievements by account and payouts by payout", () => {
    expect(certificateDedupeKey("CHALLENGE_PASSED", { accountId: "acc1" })).toBe("CHALLENGE_PASSED:acc1");
    expect(certificateDedupeKey("FUNDED", { accountId: "acc2" })).toBe("FUNDED:acc2");
    expect(certificateDedupeKey("PAYOUT", { accountId: "acc2", payoutId: "p1" })).toBe("PAYOUT:p1");
    expect(() => certificateDedupeKey("PAYOUT", { accountId: "acc2" })).toThrow();
  });
});
