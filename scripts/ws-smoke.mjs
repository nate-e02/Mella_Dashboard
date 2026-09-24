#!/usr/bin/env node
/**
 * Smoke test for the trading worker's WebSocket gateway.
 *
 *   node scripts/ws-smoke.mjs [userId] [symbol]
 *
 * Mints a 60 s ws ticket for the user (first user in the DB when omitted),
 * connects to ws://localhost:$WORKER_PORT/ws, subscribes to ticks:<symbol>
 * (default EURUSD) and market, prints 5 ticks, then exits.
 */
import "dotenv/config";
import { SignJWT } from "jose";
import WebSocket from "ws";

const secret = process.env.JWT_SECRET;
if (!secret) {
  console.error("JWT_SECRET is not set");
  process.exit(1);
}

let userId = process.argv[2];
let role = "TRADER";
if (!userId) {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, role: true, email: true } });
  await prisma.$disconnect();
  if (!user) {
    console.error("no users in the database; pass a userId");
    process.exit(1);
  }
  userId = user.id;
  role = user.role;
  console.log(`using user ${user.email} (${user.id}, ${user.role})`);
}
const symbol = process.argv[3] || "EURUSD";

const ticket = await new SignJWT({ purpose: "ws", role })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(userId)
  .setIssuedAt()
  .setExpirationTime("60s")
  .sign(new TextEncoder().encode(secret));

const port = process.env.WORKER_PORT || 4100;
const url = `ws://localhost:${port}/ws?ticket=${encodeURIComponent(ticket)}`;
console.log(`connecting to ws://localhost:${port}/ws`);
const ws = new WebSocket(url);
let ticks = 0;
const timeout = setTimeout(() => {
  console.error("timed out waiting for ticks");
  process.exit(2);
}, 20_000);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "subscribe", channels: [`ticks:${symbol}`, "market"] }));
});
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === "tick") {
    ticks += 1;
    console.log(`tick ${ticks}: ${msg.symbol} bid=${msg.bid} ask=${msg.ask} ts=${new Date(msg.ts).toISOString()}`);
    if (ticks >= 5) {
      clearTimeout(timeout);
      ws.close();
      console.log("ok");
      process.exit(0);
    }
  } else if (msg.type === "market.status") {
    console.log(`market.status: ${msg.state}${msg.reason ? ` (${msg.reason})` : ""}`);
  } else {
    console.log(`${msg.type}: ${JSON.stringify(msg)}`);
  }
});
ws.on("close", (code, reason) => {
  if (ticks < 5) {
    console.error(`closed early: ${code} ${reason}`);
    process.exit(3);
  }
});
ws.on("error", (err) => {
  console.error("socket error:", err.message);
  process.exit(4);
});
