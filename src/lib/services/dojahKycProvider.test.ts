import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

const SECRET = "test-dojah-secret-key";

function headersFrom(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

function setEnv() {
  process.env.DOJAH_APP_ID = "app-1";
  process.env.DOJAH_PUBLIC_KEY = "pub-1";
  process.env.DOJAH_SECRET_KEY = SECRET;
  process.env.DOJAH_WIDGET_ID = "widget-1";
}

describe("dojahKycProvider.verifyWebhookSignature", () => {
  beforeEach(() => {
    setEnv();
    vi.resetModules();
  });

  it("accepts a valid x-dojah-signature (HMAC-SHA256 of the raw body, keyed with the secret)", async () => {
    const { dojahKycProvider } = await import("@/lib/services/dojahKycProvider");
    const rawBody = JSON.stringify({ reference_id: "ref-1", verification_status: "Completed", status: true });
    const valid = createHmac("sha256", SECRET).update(rawBody).digest("hex");

    expect(dojahKycProvider.verifyWebhookSignature(rawBody, headersFrom({ "x-dojah-signature": valid }))).toBe(true);
  });

  it("rejects an incorrect x-dojah-signature", async () => {
    const { dojahKycProvider } = await import("@/lib/services/dojahKycProvider");
    const rawBody = JSON.stringify({ reference_id: "ref-1" });

    expect(dojahKycProvider.verifyWebhookSignature(rawBody, headersFrom({ "x-dojah-signature": "0".repeat(64) }))).toBe(false);
  });

  it("rejects a signature computed against a tampered body", async () => {
    const { dojahKycProvider } = await import("@/lib/services/dojahKycProvider");
    const originalBody = JSON.stringify({ reference_id: "ref-1", status: false });
    const sig = createHmac("sha256", SECRET).update(originalBody).digest("hex");
    const tamperedBody = JSON.stringify({ reference_id: "ref-1", status: true });

    expect(dojahKycProvider.verifyWebhookSignature(tamperedBody, headersFrom({ "x-dojah-signature": sig }))).toBe(false);
  });

  it("accepts a valid x-dojah-signature-v2 (HMAC-SHA256 of the secret key itself) when the body signature is absent", async () => {
    const { dojahKycProvider } = await import("@/lib/services/dojahKycProvider");
    const rawBody = JSON.stringify({ reference_id: "ref-1" });
    const keySig = createHmac("sha256", SECRET).update(SECRET).digest("hex");

    expect(dojahKycProvider.verifyWebhookSignature(rawBody, headersFrom({ "x-dojah-signature-v2": keySig }))).toBe(true);
  });

  it("rejects when neither signature header is present", async () => {
    const { dojahKycProvider } = await import("@/lib/services/dojahKycProvider");
    expect(dojahKycProvider.verifyWebhookSignature("{}", headersFrom({}))).toBe(false);
  });

  it("throws if Dojah env vars are not configured, rather than silently accepting", async () => {
    delete process.env.DOJAH_SECRET_KEY;
    vi.resetModules();
    const { dojahKycProvider } = await import("@/lib/services/dojahKycProvider");

    expect(() => dojahKycProvider.verifyWebhookSignature("{}", headersFrom({ "x-dojah-signature": "x" }))).toThrow();
  });
});

describe("dojahKycProvider.parseWebhookPayload - normalization", () => {
  beforeEach(() => {
    setEnv();
    vi.resetModules();
  });

  async function parse(payload: unknown) {
    const { dojahKycProvider } = await import("@/lib/services/dojahKycProvider");
    return dojahKycProvider.parseWebhookPayload(JSON.stringify(payload));
  }

  it("normalizes Completed + status:true to VERIFIED", async () => {
    const result = await parse({ reference_id: "ref-1", verification_status: "Completed", status: true });
    expect(result).toEqual({ referenceId: "ref-1", result: { outcome: "VERIFIED" } });
  });

  it("normalizes Completed + status:false to FAILED with a safe step-derived reason", async () => {
    const result = await parse({
      reference_id: "ref-1",
      verification_status: "Completed",
      status: false,
      data: { government_data: { status: false, message: "mismatch" }, selfie: { status: true } },
    });
    expect(result?.result.outcome).toBe("FAILED");
    expect(result?.result.failureReason).toBe("government_data_verification_failed");
  });

  it("normalizes an explicit Failed verification_status to FAILED", async () => {
    const result = await parse({ reference_id: "ref-1", verification_status: "Failed", status: false });
    expect(result).toEqual({ referenceId: "ref-1", result: { outcome: "FAILED", failureReason: "provider_reported_failed" } });
  });

  it("normalizes Abandoned to FAILED with a distinct reason", async () => {
    const result = await parse({ reference_id: "ref-1", verification_status: "Abandoned", status: false });
    expect(result?.result).toEqual({ outcome: "FAILED", failureReason: "abandoned_by_user" });
  });

  it("normalizes Ongoing to PENDING", async () => {
    const result = await parse({ reference_id: "ref-1", verification_status: "Ongoing", status: false });
    expect(result?.result.outcome).toBe("PENDING");
  });

  it("normalizes Pending to PENDING", async () => {
    const result = await parse({ reference_id: "ref-1", verification_status: "Pending", status: false });
    expect(result?.result.outcome).toBe("PENDING");
  });

  it("treats an unrecognized/future verification_status as PENDING rather than guessing pass/fail", async () => {
    const result = await parse({ reference_id: "ref-1", verification_status: "SomeNewStatus", status: true });
    expect(result?.result.outcome).toBe("PENDING");
  });

  it("returns null for malformed JSON", async () => {
    const { dojahKycProvider } = await import("@/lib/services/dojahKycProvider");
    expect(dojahKycProvider.parseWebhookPayload("not json")).toBeNull();
  });

  it("returns null when reference_id is missing", async () => {
    const result = await parse({ verification_status: "Completed", status: true });
    expect(result).toBeNull();
  });

  it("never includes raw identity data, document/selfie URLs, or the provider's raw data object in the normalized result", async () => {
    const result = await parse({
      reference_id: "ref-1",
      verification_status: "Completed",
      status: false,
      id_url: "https://dojah.io/signed/id.jpg",
      selfie_url: "https://dojah.io/signed/selfie.jpg",
      value: "SENSITIVE-FAYDA-ID-NUMBER-1234567890",
      data: { government_data: { status: false, message: "mismatch", data: { full_name: "Jane Doe", id_number: "1234567890" } } },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("SENSITIVE-FAYDA-ID-NUMBER");
    expect(serialized).not.toContain("Jane Doe");
    expect(serialized).not.toContain("id_url");
    expect(serialized).not.toContain("selfie_url");
    expect(serialized).not.toContain("dojah.io/signed");
  });
});

describe("dojahKycProvider.createVerificationSession", () => {
  beforeEach(() => {
    setEnv();
    vi.resetModules();
  });

  it("returns client-safe config (app id, public key, widget id) built from env vars, never the secret key", async () => {
    const { dojahKycProvider } = await import("@/lib/services/dojahKycProvider");

    const session = await dojahKycProvider.createVerificationSession({
      referenceId: "ref-123",
      user: { id: "u1", name: "Jane Doe", email: "jane@example.com" },
    });

    expect(session).toMatchObject({ appId: "app-1", publicKey: "pub-1", widgetId: "widget-1", referenceId: "ref-123" });
    expect(JSON.stringify(session)).not.toContain(SECRET);
  });

  it("throws a clean error when Dojah is not configured", async () => {
    delete process.env.DOJAH_WIDGET_ID;
    vi.resetModules();
    const { dojahKycProvider } = await import("@/lib/services/dojahKycProvider");

    await expect(
      dojahKycProvider.createVerificationSession({ referenceId: "ref-1", user: { id: "u1", name: "Jane", email: "jane@example.com" } }),
    ).rejects.toThrow(/not configured/);
  });
});
