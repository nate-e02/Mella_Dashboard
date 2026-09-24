import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { jwtVerify } from "jose";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { CLIENT_TICK_RATE_PER_SEC, TIMEFRAMES, channels as channelNames, type ClientMessage, type ServerMessage, type Timeframe } from "@/trading/protocol";
import type { TradingBus } from "./bus";
import { Coalescer } from "./coalesce";
import type { Engine, EngineLogger } from "./engine";
import { applyMarkup } from "./math";

/**
 * WebSocket gateway: authenticates the `?ticket=` JWT, manages channel
 * subscriptions, fans out bus events with per-connection coalescing and
 * backpressure, and forwards trading commands to the engine.
 */

export type GatewayOptions = {
  server: HttpServer;
  bus: TradingBus;
  engine: Engine;
  log: EngineLogger;
  jwtSecret: string;
  path?: string;
  maxConnections?: number;
  heartbeatMs?: number;
};

const MAX_CHANNELS = 50;
const MAX_INBOUND_PER_SEC = 20;
const MAX_BUFFERED_BYTES = 1024 * 1024;
const TICK_INTERVAL_MS = Math.floor(1000 / CLIENT_TICK_RATE_PER_SEC);
const BAR_INTERVAL_MS = TICK_INTERVAL_MS;
const ACCOUNT_INTERVAL_MS = 250;
const FLUSH_MS = 50;
const MAX_FRAME_BYTES = 16 * 1024;

const idSchema = z.string().min(1).max(64);
const priceSchema = z.number().finite().positive();
const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribe"), channels: z.array(z.string().min(1).max(80)).max(MAX_CHANNELS) }),
  z.object({ type: z.literal("unsubscribe"), channels: z.array(z.string().min(1).max(80)).max(MAX_CHANNELS) }),
  z.object({
    type: z.literal("order.place"),
    accountId: idSchema,
    clientOrderId: idSchema,
    symbol: z.string().min(1).max(32),
    side: z.enum(["BUY", "SELL"]),
    orderType: z.enum(["MARKET", "LIMIT", "STOP"]),
    volume: z.number().finite().positive(),
    price: priceSchema.optional(),
    stopLoss: priceSchema.optional(),
    takeProfit: priceSchema.optional(),
  }),
  z.object({ type: z.literal("position.close"), accountId: idSchema, positionId: idSchema, volume: z.number().finite().positive().optional() }),
  z.object({ type: z.literal("position.modify"), accountId: idSchema, positionId: idSchema, stopLoss: priceSchema.nullable().optional(), takeProfit: priceSchema.nullable().optional() }),
  z.object({ type: z.literal("account.get"), accountId: idSchema }),
  z.object({ type: z.literal("ping") }),
]);

export function parseClientMessage(raw: unknown): { ok: true; message: ClientMessage } | { ok: false; error: string } {
  const result = clientMessageSchema.safeParse(raw);
  if (!result.success) return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".") || "message"}: ${i.message}`).join("; ") };
  return { ok: true, message: result.data as ClientMessage };
}

export type ParsedChannel = { kind: "ticks"; symbol: string } | { kind: "bars"; symbol: string; tf: Timeframe } | { kind: "account"; accountId: string } | { kind: "market" };

export function parseChannel(name: string): ParsedChannel | null {
  if (name === channelNames.market) return { kind: "market" };
  const parts = name.split(":");
  if (parts[0] === "ticks" && parts.length === 2 && parts[1]) return { kind: "ticks", symbol: parts[1] };
  if (parts[0] === "bars" && parts.length === 3 && parts[1] && (TIMEFRAMES as string[]).includes(parts[2])) return { kind: "bars", symbol: parts[1], tf: parts[2] as Timeframe };
  if (parts[0] === "account" && parts.length === 2 && parts[1]) return { kind: "account", accountId: parts[1] };
  return null;
}

export type TicketClaims = { userId: string; role: string };

export async function verifyTicket(ticket: string, secret: string): Promise<TicketClaims> {
  const { payload } = await jwtVerify(ticket, new TextEncoder().encode(secret), { algorithms: ["HS256"] });
  if (payload.purpose !== "ws") throw new Error("ticket purpose is not ws");
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("ticket has no subject");
  const role = typeof payload.role === "string" ? payload.role : "TRADER";
  return { userId: payload.sub, role };
}

type Client = {
  id: number;
  ws: WebSocket;
  userId: string;
  role: string;
  subs: Set<string>;
  owned: Map<string, boolean>;
  coalescer: Coalescer<ServerMessage>;
  alive: boolean;
  windowStart: number;
  windowCount: number;
};

export class Gateway {
  private wss: WebSocketServer;
  private clients = new Set<Client>();
  private subscribers = new Map<string, Set<Client>>();
  private nextId = 1;
  private timers: NodeJS.Timeout[] = [];
  private unsubscribeBus: (() => void)[] = [];
  private readonly path: string;
  private readonly maxConnections: number;
  private upgradeHandler: ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | null = null;

  constructor(private readonly opts: GatewayOptions) {
    this.path = opts.path ?? "/ws";
    this.maxConnections = opts.maxConnections ?? 10_000;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });
  }

  start() {
    const { server, bus, log } = this.opts;
    this.upgradeHandler = (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== this.path) {
        socket.destroy();
        return;
      }
      if (this.clients.size >= this.maxConnections) {
        socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => void this.onConnection(ws, url.searchParams.get("ticket") ?? ""));
    };
    server.on("upgrade", this.upgradeHandler);

    this.unsubscribeBus.push(
      bus.on("tick", (tick) => {
        const subs = this.subscribers.get(channelNames.ticks(tick.symbol));
        if (!subs || subs.size === 0) return;
        const inst = this.opts.engine.instruments.get(tick.symbol);
        const q = inst ? applyMarkup(tick, inst.spreadMarkupPoints, inst.digits) : tick;
        const frame: ServerMessage = { type: "tick", symbol: tick.symbol, bid: q.bid, ask: q.ask, ts: tick.ts };
        for (const c of subs) this.sendCoalesced(c, `tick:${tick.symbol}`, frame, TICK_INTERVAL_MS, true);
      }),
      bus.on("bar", (ev) => {
        const subs = this.subscribers.get(channelNames.bars(ev.symbol, ev.tf));
        if (!subs || subs.size === 0) return;
        const frame: ServerMessage = { type: "bar", symbol: ev.symbol, tf: ev.tf, bar: { ...ev.bar, time: ev.bar.time > 1e11 ? Math.floor(ev.bar.time / 1000) : ev.bar.time } };
        for (const c of subs) this.sendCoalesced(c, `bar:${ev.symbol}:${ev.tf}`, frame, BAR_INTERVAL_MS, true);
      }),
      bus.on("account", (account) => {
        const subs = this.subscribers.get(channelNames.account(account.accountId));
        if (!subs) return;
        const frame: ServerMessage = { type: "account", account };
        for (const c of subs) this.sendCoalesced(c, `account:${account.accountId}`, frame, ACCOUNT_INTERVAL_MS, false);
      }),
      bus.on("position", (ev) => {
        const subs = this.subscribers.get(channelNames.account(ev.accountId));
        if (!subs) return;
        const frame: ServerMessage = { type: "position", accountId: ev.accountId, event: ev.event, position: ev.position, closeReason: ev.closeReason, realizedPnl: ev.realizedPnl };
        for (const c of subs) this.send(c, frame);
      }),
      bus.on("order.result", (ev) => {
        const subs = this.subscribers.get(channelNames.account(ev.accountId));
        if (!subs) return;
        const frame: ServerMessage = { type: "order.result", clientOrderId: ev.clientOrderId, status: ev.status, orderId: ev.orderId, positionId: ev.positionId, filledPrice: ev.filledPrice, reason: ev.reason };
        for (const c of subs) this.send(c, frame);
      }),
      bus.on("market.status", (ev) => {
        const frame: ServerMessage = { type: "market.status", state: ev.state, reason: ev.reason, symbols: ev.symbols };
        for (const c of this.clients) this.send(c, frame);
      }),
    );

    this.timers.push(setInterval(() => this.flushAll(), FLUSH_MS));
    this.timers.push(
      setInterval(() => {
        for (const c of this.clients) {
          if (!c.alive) {
            log.debug({ client: c.id }, "gateway: dropping dead socket");
            c.ws.terminate();
            continue;
          }
          c.alive = false;
          try {
            c.ws.ping();
          } catch {
            c.ws.terminate();
          }
        }
      }, this.opts.heartbeatMs ?? 25_000),
    );
    log.info({ path: this.path, maxConnections: this.maxConnections }, "gateway: listening");
  }

  async stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const u of this.unsubscribeBus) u();
    this.unsubscribeBus = [];
    if (this.upgradeHandler) this.opts.server.off("upgrade", this.upgradeHandler);
    for (const c of this.clients) {
      try {
        c.ws.close(1001, "server shutting down");
      } catch {
        // ignore
      }
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  connectionCount(): number {
    return this.clients.size;
  }

  private async onConnection(ws: WebSocket, ticket: string) {
    const { log } = this.opts;
    // Frames that arrive while the ticket is still being verified (clients
    // typically subscribe in their `open` handler) must not be lost: buffer
    // them and replay once the connection is authenticated.
    const early: string[] = [];
    const bufferEarly = (data: Buffer | ArrayBuffer | Buffer[]) => {
      if (early.length < 64) early.push(data.toString());
    };
    ws.on("message", bufferEarly);
    let claims: TicketClaims;
    try {
      if (!ticket) throw new Error("missing ticket");
      claims = await verifyTicket(ticket, this.opts.jwtSecret);
    } catch (err) {
      const frame: ServerMessage = { type: "error", code: "UNAUTHORIZED", message: `Invalid or expired ticket: ${(err as Error).message}` };
      try {
        ws.send(JSON.stringify(frame));
        ws.close(4401, "unauthorized");
      } catch {
        ws.terminate();
      }
      return;
    }
    const client: Client = {
      id: this.nextId++,
      ws,
      userId: claims.userId,
      role: claims.role,
      subs: new Set(),
      owned: new Map(),
      coalescer: new Coalescer<ServerMessage>(),
      alive: true,
      windowStart: Date.now(),
      windowCount: 0,
    };
    this.clients.add(client);
    ws.on("pong", () => {
      client.alive = true;
    });
    ws.off("message", bufferEarly);
    ws.on("message", (data) => void this.onMessage(client, data.toString()));
    ws.on("error", (err) => log.debug({ client: client.id, err: err.message }, "gateway: socket error"));
    ws.on("close", () => {
      for (const ch of client.subs) this.subscribers.get(ch)?.delete(client);
      this.clients.delete(client);
    });
    this.send(client, { type: "auth.ok", userId: client.userId, serverTime: Date.now() });
    const ms = this.opts.engine.marketStatus();
    this.send(client, { type: "market.status", state: ms.state, reason: ms.reason, symbols: ms.symbols });
    log.debug({ client: client.id, userId: client.userId }, "gateway: connected");
    for (const raw of early) await this.onMessage(client, raw);
  }

  private async onMessage(client: Client, raw: string) {
    const now = Date.now();
    if (now - client.windowStart >= 1000) {
      client.windowStart = now;
      client.windowCount = 0;
    }
    client.windowCount += 1;
    if (client.windowCount > MAX_INBOUND_PER_SEC) {
      this.send(client, { type: "error", code: "RATE_LIMITED", message: `More than ${MAX_INBOUND_PER_SEC} messages per second` });
      client.ws.close(4429, "rate limited");
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.send(client, { type: "error", code: "BAD_JSON", message: "Frames must be JSON objects" });
      return;
    }
    const parsed = parseClientMessage(json);
    if (!parsed.ok) {
      const ref = typeof (json as { clientOrderId?: unknown })?.clientOrderId === "string" ? (json as { clientOrderId: string }).clientOrderId : undefined;
      this.send(client, { type: "error", code: "BAD_REQUEST", message: parsed.error, ref });
      return;
    }
    const message = parsed.message;
    try {
      switch (message.type) {
        case "ping":
          this.send(client, { type: "pong", serverTime: Date.now() });
          return;
        case "subscribe":
          await this.subscribe(client, message.channels);
          return;
        case "unsubscribe":
          for (const ch of message.channels) {
            client.subs.delete(ch);
            this.subscribers.get(ch)?.delete(client);
            client.coalescer.forget(ch);
          }
          return;
        default: {
          const replies = await this.opts.engine.handle({ userId: client.userId, role: client.role }, message);
          for (const r of replies) this.send(client, r);
        }
      }
    } catch (err) {
      this.opts.log.error({ err: (err as Error).message, type: message.type, client: client.id }, "gateway: message handling failed");
      const ref = "clientOrderId" in message ? message.clientOrderId : "positionId" in message ? message.positionId : undefined;
      this.send(client, { type: "error", code: "INTERNAL", message: "Request failed", ref });
    }
  }

  private async subscribe(client: Client, requested: string[]) {
    for (const name of requested) {
      const ch = parseChannel(name);
      if (!ch) {
        this.send(client, { type: "error", code: "BAD_CHANNEL", message: `Unknown channel ${name}`, ref: name });
        continue;
      }
      if (client.subs.has(name)) continue;
      if (client.subs.size >= MAX_CHANNELS) {
        this.send(client, { type: "error", code: "TOO_MANY_CHANNELS", message: `At most ${MAX_CHANNELS} channels per connection`, ref: name });
        break;
      }
      if (ch.kind === "account") {
        const allowed = await this.ownsAccount(client, ch.accountId);
        if (!allowed) {
          this.send(client, { type: "error", code: "FORBIDDEN", message: "Account does not belong to you", ref: name });
          continue;
        }
      }
      client.subs.add(name);
      let set = this.subscribers.get(name);
      if (!set) {
        set = new Set();
        this.subscribers.set(name, set);
      }
      set.add(client);

      if (ch.kind === "account") {
        let state = this.opts.engine.getAccountState(ch.accountId);
        if (!state) {
          const acct = await this.opts.engine.reloadAccount(ch.accountId).catch(() => null);
          state = acct ? this.opts.engine.accountState(acct) : null;
        }
        if (state) this.send(client, { type: "account", account: state });
      } else if (ch.kind === "ticks") {
        const q = this.opts.engine.quote(ch.symbol);
        if (q) this.send(client, { type: "tick", symbol: ch.symbol, bid: q.bid, ask: q.ask, ts: q.ts });
      } else if (ch.kind === "market") {
        const ms = this.opts.engine.marketStatus();
        this.send(client, { type: "market.status", state: ms.state, reason: ms.reason, symbols: ms.symbols });
      }
    }
  }

  private async ownsAccount(client: Client, accountId: string): Promise<boolean> {
    if (client.role === "ADMIN") return true;
    const cached = client.owned.get(accountId);
    if (cached !== undefined) return cached;
    const row = await prisma.tradingAccount.findUnique({ where: { id: accountId }, select: { userId: true } });
    const owns = row?.userId === client.userId;
    client.owned.set(accountId, owns);
    return owns;
  }

  private send(client: Client, frame: ServerMessage) {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    try {
      client.ws.send(JSON.stringify(frame));
    } catch (err) {
      this.opts.log.debug({ client: client.id, err: (err as Error).message }, "gateway: send failed");
    }
  }

  /** Coalesced send; `droppable` frames are skipped under backpressure. */
  private sendCoalesced(client: Client, key: string, frame: ServerMessage, intervalMs: number, droppable: boolean) {
    if (droppable && client.ws.bufferedAmount > MAX_BUFFERED_BYTES) return;
    const now = client.coalescer.offer(key, frame, intervalMs);
    if (now) this.send(client, now);
  }

  private flushAll() {
    for (const c of this.clients) {
      if (c.coalescer.pendingCount() === 0) continue;
      const backpressured = c.ws.bufferedAmount > MAX_BUFFERED_BYTES;
      for (const { value } of c.coalescer.drain()) {
        if (backpressured && (value.type === "tick" || value.type === "bar")) continue;
        this.send(c, value);
      }
    }
  }
}
