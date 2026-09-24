#!/usr/bin/env node
/**
 * End-to-end smoke test against a running web app (default http://localhost:3000)
 * and trading worker (default ws://localhost:4100/ws):
 *   login -> instruments -> ws ticket -> subscribe ticks -> market order ->
 *   order.result -> account frame -> close position -> account state via REST.
 *
 * Usage: node scripts/e2e-smoke.mjs [email] [password]
 * Env:   APP_URL, NEXT_PUBLIC_WS_URL
 */
import WebSocket from "ws";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const email = process.argv[2] ?? "alex@mellafx.local";
const password = process.argv[3] ?? process.env.SEED_TRADER_PASSWORD ?? "Trader1234!ChangeMe";

const jar = new Map();
function cookieHeader() {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}
async function api(path, init = {}) {
  const res = await fetch(`${APP}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Origin: APP, Cookie: cookieHeader(), ...(init.headers ?? {}) },
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const [k, v] = pair.split("=");
    jar.set(k, v);
  }
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
if (login.status !== 200 || login.body?.mfaRequired) fail(`login ${login.status} ${JSON.stringify(login.body)}`);
console.log("login ok:", login.body.email, login.body.role);

const health = await api("/api/health");
if (!health.body?.ok) fail("health check failed");
console.log("health ok");

const instruments = await api("/api/market/instruments");
if (instruments.status !== 200 || !Array.isArray(instruments.body) || instruments.body.length === 0) fail("no instruments");
const symbol = instruments.body.find((i) => i.symbol === "EURUSD")?.symbol ?? instruments.body[0].symbol;
console.log("instruments:", instruments.body.length, "using", symbol);

const accounts = await api("/api/trader/accounts");
const tradable = (accounts.body ?? []).find((a) => a.status === "ACTIVE" || a.status === "FUNDED");
if (!tradable) fail("no tradable account for this trader");
console.log("account:", tradable.id, tradable.status);

const ticket = await api("/api/trader/ws-ticket", { method: "POST", body: "{}" });
if (ticket.status !== 200) fail(`ws-ticket ${ticket.status}`);
const wsUrl = `${ticket.body.wsUrl}?ticket=${encodeURIComponent(ticket.body.ticket)}`;

const ws = new WebSocket(wsUrl);
const waitFor = (pred, timeoutMs = 15000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for " + pred.toString().slice(0, 60))), timeoutMs);
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (pred(msg)) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });

await new Promise((resolve, reject) => {
  ws.once("open", resolve);
  ws.once("error", reject);
});
const auth = await waitFor((m) => m.type === "auth.ok" || m.type === "error");
if (auth.type !== "auth.ok") fail(`ws auth ${JSON.stringify(auth)}`);
console.log("ws auth ok");

ws.send(JSON.stringify({ type: "subscribe", channels: [`ticks:${symbol}`, `account:${tradable.id}`, "market"] }));
const tick = await waitFor((m) => m.type === "tick" && m.symbol === symbol);
console.log("tick:", symbol, tick.bid, tick.ask);
const market = await waitFor((m) => m.type === "market.status", 5000).catch(() => null);
if (market && market.state !== "OPEN") fail(`market ${market.state}: ${market.reason}`);

const clientOrderId = crypto.randomUUID();
ws.send(JSON.stringify({ type: "order.place", accountId: tradable.id, clientOrderId, symbol, side: "BUY", orderType: "MARKET", volume: 0.1 }));
const result = await waitFor((m) => m.type === "order.result" && m.clientOrderId === clientOrderId);
if (result.status !== "FILLED") fail(`order not filled: ${JSON.stringify(result)}`);
console.log("order filled at", result.filledPrice, "position", result.positionId);

const accountFrame = await waitFor((m) => m.type === "account" && m.account.positions.some((p) => p.id === result.positionId));
console.log("account frame: equity", accountFrame.account.equity, "marginUsed", accountFrame.account.marginUsed);

ws.send(JSON.stringify({ type: "position.close", accountId: tradable.id, positionId: result.positionId }));
const closed = await waitFor((m) => m.type === "position" && m.event === "CLOSED" && m.position.id === result.positionId);
console.log("position closed, realized", closed.realizedPnl);

const state = await api(`/api/trader/accounts/${tradable.id}/state`);
if (state.status !== 200) fail(`state ${state.status}`);
const stillOpen = state.body.positions.find((p) => p.id === result.positionId);
if (stillOpen) fail("position still open in REST state");
console.log("REST state: balance", state.body.balance, "equity", state.body.equity, "positions", state.body.positions.length);

const trades = await api(`/api/trader/accounts/${tradable.id}/trades?timeframe=all_time`);
const trade = (trades.body?.items ?? []).find((t) => t.symbol === symbol && t.status === "CLOSED");
if (!trade) fail("closed trade not found in history");
console.log("trade recorded:", trade.symbol, trade.side, trade.volume, "netProfit", trade.netProfit);

ws.close();
console.log("E2E OK");
process.exit(0);
