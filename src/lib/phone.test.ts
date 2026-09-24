import { describe, expect, it } from "vitest";
import { formatPhone, isEthiopianMobile, maskPhone, normalizePhone } from "@/lib/phone";

describe("normalizePhone", () => {
  it.each([
    ["0911234567", "+251911234567"],
    ["0911 23 45 67", "+251911234567"],
    ["0911-234-567", "+251911234567"],
    ["(0911) 234 567", "+251911234567"],
    ["911234567", "+251911234567"],
    ["251911234567", "+251911234567"],
    ["+251911234567", "+251911234567"],
    ["+251 91 123 4567", "+251911234567"],
    ["00251911234567", "+251911234567"],
    ["+251 0911 234 567", "+251911234567"],
    ["2510911234567", "+251911234567"],
    // Safaricom Ethiopia (07…)
    ["0712345678", "+251712345678"],
    ["712345678", "+251712345678"],
    ["+251712345678", "+251712345678"],
    ["  0911.234.567 ", "+251911234567"],
  ])("normalises Ethiopian mobile %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    ["+14155552671", "+14155552671"],
    ["+44 20 7946 0958", "+442079460958"],
    ["+971 50 123 4567", "+971501234567"],
    ["0044 7911 123456", "+447911123456"],
  ])("accepts international E.164 %s for the diaspora", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "0111234567", // Addis landline: cannot receive SMS
    "+251111234567",
    "+25191123456", // one digit short
    "+2519112345678", // one digit long
    "091123456",
    "0811234567",
    "12345",
    "+1234567", // too short for E.164
    "+0123456789",
    "+1415555267112345", // 16 digits
    "0911abc567",
    "0911+234567",
    "tel:0911234567",
    "0911234567; DROP TABLE",
  ])("rejects %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it("rejects non-strings", () => {
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone(911234567)).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("maskPhone / formatPhone", () => {
  it("masks an Ethiopian number, keeping the operator digit and the last three", () => {
    expect(maskPhone("+251912345567")).toBe("+251 9•• ••• 567");
    expect(maskPhone("+251712345678")).toBe("+251 7•• ••• 678");
  });

  it("masks other numbers without revealing the middle digits", () => {
    const masked = maskPhone("+14155552671");
    expect(masked.startsWith("+14")).toBe(true);
    expect(masked.endsWith("671")).toBe(true);
    expect(masked).not.toContain("555");
  });

  it("formats Ethiopian numbers in 3-digit groups and leaves others alone", () => {
    expect(formatPhone("+251912345567")).toBe("+251 912 345 567");
    expect(formatPhone("+14155552671")).toBe("+14155552671");
    expect(isEthiopianMobile("+251912345567")).toBe(true);
    expect(isEthiopianMobile("+14155552671")).toBe(false);
  });
});
