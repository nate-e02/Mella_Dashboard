import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, nullIfUnknown } from "./rateLimit";

const h = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });

describe("clientIpFromHeaders", () => {
  it("uses the right-most X-Forwarded-For entry by default (the address our proxy saw)", () => {
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "203.0.113.9" }), {})).toBe("203.0.113.9");
    // A client-supplied prefix cannot choose the bucket.
    expect(clientIpFromHeaders(h({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }), {})).toBe("203.0.113.9");
  });

  it("ignores client-sent cf-connecting-ip / x-real-ip unless configured", () => {
    expect(clientIpFromHeaders(h({ "cf-connecting-ip": "9.9.9.9", "x-real-ip": "8.8.8.8", "x-forwarded-for": "203.0.113.9" }), {})).toBe("203.0.113.9");
  });

  it("honours TRUSTED_PROXY_HOPS for a chain of trusted proxies", () => {
    const headers = h({ "x-forwarded-for": "6.6.6.6, 198.51.100.7, 10.0.0.2" });
    expect(clientIpFromHeaders(headers, { TRUSTED_PROXY_HOPS: "2" })).toBe("198.51.100.7");
    expect(clientIpFromHeaders(headers, { TRUSTED_PROXY_HOPS: "9" })).toBe("6.6.6.6");
  });

  it("reads the configured edge header (Cloudflare, nginx)", () => {
    expect(clientIpFromHeaders(h({ "cf-connecting-ip": "196.188.1.1", "x-forwarded-for": "1.1.1.1" }), { CLIENT_IP_HEADER: "cf-connecting-ip" })).toBe("196.188.1.1");
    expect(clientIpFromHeaders(h({ "x-real-ip": "196.188.2.2" }), { CLIENT_IP_HEADER: "X-Real-IP" })).toBe("196.188.2.2");
    expect(clientIpFromHeaders(h({}), { CLIENT_IP_HEADER: "cf-connecting-ip" })).toBe("unknown");
  });

  it("falls back to unknown and maps it to null for storage", () => {
    expect(clientIpFromHeaders(h({}), {})).toBe("unknown");
    expect(nullIfUnknown("unknown")).toBeNull();
    expect(nullIfUnknown("203.0.113.9")).toBe("203.0.113.9");
  });
});
