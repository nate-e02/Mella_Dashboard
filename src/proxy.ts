import { NextRequest, NextResponse } from "next/server";
import { clientIpFromHeaders, rateLimit } from "@/lib/auth/rateLimit";
import { wsPublicUrl } from "@/env";

/**
 * Request-boundary protections that every route gets for free:
 *  - per-IP rate limits on authentication, payment and webhook endpoints
 *  - Origin / Sec-Fetch-Site enforcement on state-changing API calls (CSRF)
 *  - JSON content-type enforcement for API bodies
 *  - security headers and a per-request nonce-based Content Security Policy
 *  - an x-request-id for log correlation
 * Authorization itself always happens in the route handlers / services.
 */

const WEBHOOK_PATHS = new Set(["/api/payments/chapa/webhook", "/api/kyc/dojah/webhook"]);

type Rule = { match: (path: string, method: string) => boolean; limit: number; windowSec: number; scope: "ip" };
const RULES: Rule[] = [
  { match: (p, m) => p === "/api/auth/login" && m === "POST", limit: 10, windowSec: 60, scope: "ip" },
  { match: (p, m) => p === "/api/auth/register" && m === "POST", limit: 5, windowSec: 3600, scope: "ip" },
  { match: (p, m) => p === "/api/auth/forgot-password" && m === "POST", limit: 5, windowSec: 3600, scope: "ip" },
  { match: (p, m) => p === "/api/auth/reset-password" && m === "POST", limit: 10, windowSec: 3600, scope: "ip" },
  { match: (p, m) => p === "/api/auth/verify-email" && m === "POST", limit: 10, windowSec: 3600, scope: "ip" },
  { match: (p, m) => p.startsWith("/api/auth/mfa/") && m === "POST", limit: 15, windowSec: 60, scope: "ip" },
  { match: (p, m) => p === "/api/account/change-password" && m === "POST", limit: 5, windowSec: 3600, scope: "ip" },
  { match: (p, m) => p === "/api/trader/purchases" && m === "POST", limit: 10, windowSec: 60, scope: "ip" },
  { match: (p) => WEBHOOK_PATHS.has(p), limit: 120, windowSec: 60, scope: "ip" },
  { match: (p) => p.startsWith("/api/"), limit: 300, windowSec: 60, scope: "ip" },
];

function hostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  const wsUrl = wsPublicUrl();
  const wsOrigin = wsUrl ? (() => { try { const u = new URL(wsUrl); return `${u.protocol}//${u.host}`; } catch { return "ws: wss:"; } })() : "ws: wss:";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${wsOrigin} https://*.dojah.io`,
    "frame-src https://widget.dojah.io https://*.dojah.io https://checkout.chapa.co",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://checkout.chapa.co",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}

function applySecurityHeaders(res: NextResponse, csp: string | null, requestId: string) {
  res.headers.set("x-request-id", requestId);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=(), usb=()");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (process.env.NODE_ENV === "production") {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  if (csp) res.headers.set("Content-Security-Policy", csp);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method.toUpperCase();
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const isApi = pathname.startsWith("/api/");
  const isWebhook = WEBHOOK_PATHS.has(pathname);

  if (isApi) {
    const ip = clientIpFromHeaders(request.headers);
    for (const rule of RULES) {
      if (!rule.match(pathname, method)) continue;
      const result = await rateLimit(`${pathname}:${ip}`, rule.limit, rule.windowSec);
      if (!result.allowed) {
        const res = NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
        res.headers.set("Retry-After", String(result.retryAfterSec));
        applySecurityHeaders(res, null, requestId);
        return res;
      }
      break; // first matching rule wins (most specific first)
    }

    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && !isWebhook) {
      // CSRF: a browser always sends Origin (or Sec-Fetch-Site) on cross-site
      // requests. Require it to match our own host.
      const fetchSite = request.headers.get("sec-fetch-site");
      const originHost = hostOf(request.headers.get("origin")) ?? hostOf(request.headers.get("referer"));
      const ownHosts = new Set([request.headers.get("host"), hostOf(process.env.APP_URL ?? null)].filter(Boolean) as string[]);
      const crossSite = fetchSite === "cross-site" || (originHost !== null && !ownHosts.has(originHost));
      if (crossSite) {
        const res = NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
        applySecurityHeaders(res, null, requestId);
        return res;
      }
      const contentType = request.headers.get("content-type") ?? "";
      const hasBody = request.headers.get("content-length") !== "0" && contentType !== "";
      if (hasBody && !contentType.toLowerCase().startsWith("application/json")) {
        const res = NextResponse.json({ error: "Unsupported content type" }, { status: 415 });
        applySecurityHeaders(res, null, requestId);
        return res;
      }
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = isApi ? null : buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  if (csp) {
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  applySecurityHeaders(response, csp, requestId);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
