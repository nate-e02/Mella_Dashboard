/**
 * k6 HTTP load test: public pages, health and an authenticated trader session.
 *
 *   k6 run -e BASE_URL=https://staging.mellafx.com -e EMAIL=alex@mellafx.local -e PASSWORD=... scripts/load/http.js
 *   docker run --rm -i -e BASE_URL=http://host.docker.internal:3000 grafana/k6 run - < scripts/load/http.js
 *
 * Targets (go-live plan): p95 < 300 ms at 500 req/s. Per-IP rate limits apply
 * (300 API req/min/IP): run against the app directly (not through Cloudflare)
 * or from several load generators, and never against production.
 */
import http from "k6/http";
import { check, group, sleep } from "k6";

const BASE = __ENV.BASE_URL || "http://localhost:3000";
const RATE = Number(__ENV.RATE || 50);

export const options = {
  scenarios: {
    browse: {
      executor: "ramping-arrival-rate",
      startRate: 5,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 500,
      stages: [
        { target: RATE, duration: "1m" },
        { target: RATE, duration: "3m" },
        { target: 0, duration: "30s" },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{kind:page}": ["p(95)<800"],
    "http_req_duration{kind:api}": ["p(95)<300"],
  },
};

export function setup() {
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email: __ENV.EMAIL || "alex@mellafx.local", password: __ENV.PASSWORD || "Trader1234!ChangeMe" }), {
    headers: { "Content-Type": "application/json", Origin: BASE },
  });
  check(res, { "login 200": (r) => r.status === 200 });
  const cookies = res.cookies;
  const name = Object.keys(cookies).find((k) => k.includes("session"));
  if (!name) throw new Error(`login failed: ${res.status} ${res.body}`);
  return { cookie: `${name}=${cookies[name][0].value}` };
}

export default function (data) {
  const auth = { headers: { Cookie: data.cookie }, tags: { kind: "api" } };
  group("public", () => {
    check(http.get(`${BASE}/`, { tags: { kind: "page" } }), { "landing 200": (r) => r.status === 200 });
    check(http.get(`${BASE}/api/health`, { tags: { kind: "api" } }), { "health 200": (r) => r.status === 200 });
  });
  group("trader", () => {
    check(http.get(`${BASE}/api/market/instruments`, auth), { "instruments 200": (r) => r.status === 200 });
    check(http.get(`${BASE}/api/trader/accounts`, auth), { "accounts 200": (r) => r.status === 200 });
    check(http.get(`${BASE}/dashboard`, { headers: { Cookie: data.cookie }, tags: { kind: "page" } }), { "dashboard 200": (r) => r.status === 200 });
  });
  sleep(Math.random());
}
