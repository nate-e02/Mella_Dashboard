/**
 * k6 WebSocket load test for the trading gateway: N concurrent terminals,
 * each subscribed to a few symbols, measuring tick delivery latency.
 *
 *   k6 run -e WS_URL=ws://localhost:4100/ws -e JWT_SECRET=... -e USER_ID=<trader id> -e VUS=1000 scripts/load/ws.js
 *   (Docker: grafana/k6 with WS_URL=ws://host.docker.internal:4100/ws)
 *
 * Local baseline (laptop, stub feed, 200 clients x 3 symbols): p95 tick latency 21 ms.
 *
 * Tickets are minted locally (HS256, same claims as POST /api/trader/ws-ticket)
 * so the web app's rate limits don't cap the connection count. Needs the
 * worker's JWT_SECRET: staging only. Target: 10k clients, p95 tick latency
 * < 100 ms in-region (the worker's clock and the load generator's must agree;
 * run both on NTP-synced hosts).
 */
import ws from "k6/ws";
import crypto from "k6/crypto";
import encoding from "k6/encoding";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

const WS_URL = __ENV.WS_URL || "ws://localhost:4100/ws";
const SECRET = __ENV.JWT_SECRET;
const USER_ID = __ENV.USER_ID;
const SYMBOLS = (__ENV.SYMBOLS || "EURUSD,GBPUSD,XAUUSD").split(",");
const HOLD_SEC = Number(__ENV.HOLD_SEC || 120);

const tickLatency = new Trend("tick_latency_ms", true);
const ticks = new Counter("ticks_received");

export const options = {
  scenarios: {
    terminals: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { target: Number(__ENV.VUS || 200), duration: "1m" },
        { target: Number(__ENV.VUS || 200), duration: `${HOLD_SEC}s` },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    tick_latency_ms: ["p(95)<250"],
    ws_connecting: ["p(95)<1000"],
    checks: ["rate>0.99"],
  },
};

function ticket() {
  const b64 = (obj) => encoding.b64encode(JSON.stringify(obj), "rawurl");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "HS256" })}.${b64({ role: "TRADER", purpose: "ws", sub: USER_ID, iat: now, exp: now + 60 })}`;
  return `${unsigned}.${crypto.hmac("sha256", SECRET, unsigned, "base64rawurl")}`;
}

export default function () {
  if (!SECRET || !USER_ID) throw new Error("set JWT_SECRET and USER_ID");
  const res = ws.connect(`${WS_URL}?ticket=${ticket()}`, null, (socket) => {
    socket.on("open", () => socket.send(JSON.stringify({ type: "subscribe", channels: [...SYMBOLS.map((s) => `ticks:${s}`), "market"] })));
    socket.on("message", (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === "tick") {
        ticks.add(1);
        tickLatency.add(Date.now() - msg.ts);
      }
    });
    socket.setInterval(() => socket.send(JSON.stringify({ type: "ping" })), 20_000);
    socket.setTimeout(() => socket.close(), (HOLD_SEC + 30) * 1000);
  });
  check(res, { "ws upgraded (101)": (r) => r && r.status === 101 });
}
