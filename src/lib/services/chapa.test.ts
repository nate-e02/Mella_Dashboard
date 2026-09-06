import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";

const SECRET = "test-chapa-secret-key";

function headersFrom(map: Record<string, string>) {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

describe("verifyChapaWebhookSignature", () => {
  const originalEnv = process.env.CHAPA_SECRET_KEY;

  beforeEach(() => {
    process.env.CHAPA_SECRET_KEY = SECRET;
    vi.resetModules();
  });

  afterEach(() => {
    process.env.CHAPA_SECRET_KEY = originalEnv;
  });

  it("accepts a valid x-chapa-signature (HMAC-SHA256 of the raw body, keyed with the secret)", async () => {
    const { verifyChapaWebhookSignature } = await import("@/lib/services/chapa");
    const rawBody = JSON.stringify({ tx_ref: "abc-123", status: "success" });
    const validSignature = createHmac("sha256", SECRET).update(rawBody).digest("hex");

    const result = verifyChapaWebhookSignature(rawBody, headersFrom({ "x-chapa-signature": validSignature }));

    expect(result).toBe(true);
  });

  it("rejects an incorrect x-chapa-signature", async () => {
    const { verifyChapaWebhookSignature } = await import("@/lib/services/chapa");
    const rawBody = JSON.stringify({ tx_ref: "abc-123", status: "success" });

    const result = verifyChapaWebhookSignature(rawBody, headersFrom({ "x-chapa-signature": "0".repeat(64) }));

    expect(result).toBe(false);
  });

  it("rejects a signature computed against a tampered body", async () => {
    const { verifyChapaWebhookSignature } = await import("@/lib/services/chapa");
    const originalBody = JSON.stringify({ tx_ref: "abc-123", status: "success" });
    const signatureForOriginal = createHmac("sha256", SECRET).update(originalBody).digest("hex");
    const tamperedBody = JSON.stringify({ tx_ref: "abc-123", status: "success", amount: 1 });

    const result = verifyChapaWebhookSignature(tamperedBody, headersFrom({ "x-chapa-signature": signatureForOriginal }));

    expect(result).toBe(false);
  });

  it("accepts a valid chapa-signature (HMAC-SHA256 of the secret key itself) when x-chapa-signature is absent", async () => {
    const { verifyChapaWebhookSignature } = await import("@/lib/services/chapa");
    const rawBody = JSON.stringify({ tx_ref: "abc-123", status: "success" });
    const keySignature = createHmac("sha256", SECRET).update(SECRET).digest("hex");

    const result = verifyChapaWebhookSignature(rawBody, headersFrom({ "chapa-signature": keySignature }));

    expect(result).toBe(true);
  });

  it("rejects when neither header is present", async () => {
    const { verifyChapaWebhookSignature } = await import("@/lib/services/chapa");
    const rawBody = JSON.stringify({ tx_ref: "abc-123" });

    expect(verifyChapaWebhookSignature(rawBody, headersFrom({}))).toBe(false);
  });

  it("throws if CHAPA_SECRET_KEY is not configured, rather than silently accepting", async () => {
    delete process.env.CHAPA_SECRET_KEY;
    vi.resetModules();
    const { verifyChapaWebhookSignature } = await import("@/lib/services/chapa");

    expect(() => verifyChapaWebhookSignature("{}", headersFrom({ "x-chapa-signature": "anything" }))).toThrow();
  });
});

describe("initializeChapaTransaction / verifyChapaTransaction (fetch mocked - no real network calls)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.CHAPA_SECRET_KEY = SECRET;
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns the checkout_url from a successful initialize response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "success", data: { checkout_url: "https://checkout.chapa.co/xyz" } }), { status: 200 }),
    ) as unknown as typeof fetch;
    const { initializeChapaTransaction } = await import("@/lib/services/chapa");

    const result = await initializeChapaTransaction({
      amount: 100,
      txRef: "ref-1",
      callbackUrl: "https://app.test/cb",
      returnUrl: "https://app.test/ret",
    });

    expect(result.checkoutUrl).toBe("https://checkout.chapa.co/xyz");
  });

  it("sends the amount as ETB with no conversion, using exactly the amount it was given", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "success", data: { checkout_url: "https://checkout.chapa.co/xyz" } }), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const { initializeChapaTransaction, CHAPA_CURRENCY } = await import("@/lib/services/chapa");

    await initializeChapaTransaction({ amount: 1500, txRef: "ref-2", callbackUrl: "https://app.test/cb", returnUrl: "https://app.test/ret" });

    const [, requestInit] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(requestInit.body as string);
    expect(sentBody.amount).toBe("1500.00");
    expect(sentBody.currency).toBe(CHAPA_CURRENCY);
    expect(CHAPA_CURRENCY).toBe("ETB");
  });

  it("throws ChapaApiError (not a raw error) when Chapa does not return a checkout_url", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "failed", message: "invalid amount" }), { status: 400 })) as unknown as typeof fetch;
    const { initializeChapaTransaction, ChapaApiError } = await import("@/lib/services/chapa");

    await expect(
      initializeChapaTransaction({ amount: 100, txRef: "ref-3", callbackUrl: "https://app.test/cb", returnUrl: "https://app.test/ret" }),
    ).rejects.toBeInstanceOf(ChapaApiError);
  });

  it("throws ChapaApiError on a network failure rather than letting it propagate raw", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;
    const { initializeChapaTransaction, ChapaApiError } = await import("@/lib/services/chapa");

    await expect(
      initializeChapaTransaction({ amount: 100, txRef: "ref-4", callbackUrl: "https://app.test/cb", returnUrl: "https://app.test/ret" }),
    ).rejects.toBeInstanceOf(ChapaApiError);
  });

  it("parses a successful verification response into a normalized shape", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ status: "success", data: { status: "success", amount: "1500.00", currency: "ETB", tx_ref: "ref-5" } }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const { verifyChapaTransaction } = await import("@/lib/services/chapa");

    const result = await verifyChapaTransaction("ref-5");

    expect(result).toEqual({ paymentStatus: "success", amount: 1500, currency: "ETB", txRef: "ref-5" });
  });

  it("normalizes a pending payment status", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "success", data: { status: "pending", amount: "1500.00", currency: "ETB", tx_ref: "ref-6" } }), { status: 200 }),
    ) as unknown as typeof fetch;
    const { verifyChapaTransaction } = await import("@/lib/services/chapa");

    const result = await verifyChapaTransaction("ref-6");

    expect(result.paymentStatus).toBe("pending");
  });
});
