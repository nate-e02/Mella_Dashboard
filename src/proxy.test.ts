import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

function req(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? "GET", headers: { host: "localhost:3000", ...init.headers } });
}

describe("proxy - security headers", () => {
  it("adds a nonce-based CSP and hardening headers to page responses", async () => {
    const res = await proxy(req("/dashboard"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("proxy - CSRF", () => {
  it("blocks a cross-site POST to the API", async () => {
    const res = await proxy(req("/api/trader/purchases", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" } }));
    expect(res.status).toBe(403);
  });

  it("blocks by Sec-Fetch-Site even without an Origin header", async () => {
    const res = await proxy(req("/api/trader/purchases", { method: "POST", headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" } }));
    expect(res.status).toBe(403);
  });

  it("allows a same-origin POST and rejects non-JSON bodies", async () => {
    const ok = await proxy(req("/api/trader/purchases", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" } }));
    expect(ok.status).toBe(200);
    const form = await proxy(req("/api/trader/purchases", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "text/plain", "content-length": "5" } }));
    expect(form.status).toBe(415);
  });

  it("exempts provider webhooks from the Origin check", async () => {
    const res = await proxy(req("/api/payments/chapa/webhook", { method: "POST", headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(200);
  });
});

describe("proxy - rate limiting", () => {
  it("returns 429 with Retry-After after the login budget is exhausted", async () => {
    const headers = { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250)}`, origin: "http://localhost:3000", "content-type": "application/json" };
    let last = 200;
    for (let i = 0; i < 12; i++) {
      last = (await proxy(req("/api/auth/login", { method: "POST", headers }))).status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
    const res = await proxy(req("/api/auth/login", { method: "POST", headers }));
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});
