import { describe, expect, it } from "vitest";
import { maskDisplayName } from "@/lib/displayName";

describe("maskDisplayName", () => {
  it("shows the first name and the father's-name initial", () => {
    expect(maskDisplayName("Abebe Kebede")).toBe("Abebe K.");
    expect(maskDisplayName("Hanna Tesfaye Alemu")).toBe("Hanna T.");
    expect(maskDisplayName("  selam   yohannes ")).toBe("selam Y.");
  });

  it("keeps a single name as is and never returns an empty string", () => {
    expect(maskDisplayName("Abebe")).toBe("Abebe");
    expect(maskDisplayName("")).toBe("Trader");
    expect(maskDisplayName("   ")).toBe("Trader");
    expect(maskDisplayName(null)).toBe("Trader");
  });

  it("handles Ethiopic script by whole characters", () => {
    expect(maskDisplayName("አበበ ከበደ")).toBe("አበበ ከ.");
  });
});
