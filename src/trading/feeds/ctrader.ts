import WebSocket from "ws";
import type { Bar, Tick, Timeframe } from "@/trading/protocol";
import { backoffDelay, silentLogger, type FeedHealth, type FeedLogger, type FeedSymbol, type MarketDataProvider } from "./types";

/**
 * cTrader Open API, JSON over WebSocket (port 5036; 5035 is protobuf).
 *
 * Envelope: { "clientMsgId": string, "payloadType": number, "payload": {...} }
 * Field names and payload types verified against
 * https://help.ctrader.com/open-api/messages/ and the proto files in
 * github.com/spotware/openapi-proto-messages (OpenApiMessages.proto,
 * OpenApiModelMessages.proto, OpenApiCommonModelMessages.proto).
 *
 * Flow: ApplicationAuth (2100) -> AccountAuth (2102) -> SymbolsList (2114)
 * -> SubscribeSpots (2127) -> SpotEvent (2131) stream. Heartbeat (51) every
 * 10 s. On close: reconnect with backoff and rerun the whole flow.
 *
 * Prices in spot events and trendbars are integers scaled by 1e5.
 */

export const CT = {
  PROTO_ERROR_RES: 50,
  HEARTBEAT_EVENT: 51,
  APPLICATION_AUTH_REQ: 2100,
  APPLICATION_AUTH_RES: 2101,
  ACCOUNT_AUTH_REQ: 2102,
  ACCOUNT_AUTH_RES: 2103,
  SYMBOLS_LIST_REQ: 2114,
  SYMBOLS_LIST_RES: 2115,
  SUBSCRIBE_SPOTS_REQ: 2127,
  SUBSCRIBE_SPOTS_RES: 2128,
  UNSUBSCRIBE_SPOTS_REQ: 2129,
  SPOT_EVENT: 2131,
  GET_TRENDBARS_REQ: 2137,
  GET_TRENDBARS_RES: 2138,
  ERROR_RES: 2142,
  ACCOUNTS_TOKEN_INVALIDATED_EVENT: 2147,
  CLIENT_DISCONNECT_EVENT: 2148,
  ACCOUNT_DISCONNECT_EVENT: 2164,
} as const;

export const CTRADER_PRICE_SCALE = 100_000;

/** ProtoOATrendbarPeriod enum values. */
export const CTRADER_PERIOD: Record<Timeframe, number> = { "1m": 1, "5m": 5, "15m": 7, "1h": 9, "4h": 10, "1d": 12 };

export type CTraderEnvelope = { clientMsgId?: string; payloadType: number; payload?: Record<string, unknown> };

export type CTraderConfig = {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  /** ctidTraderAccountId */
  accountId: number;
  host?: string;
  port?: number;
};

export function readCTraderConfigFromEnv(env: Record<string, string | undefined> = process.env): CTraderConfig | null {
  const clientId = env.CTRADER_CLIENT_ID;
  const clientSecret = env.CTRADER_CLIENT_SECRET;
  const accessToken = env.CTRADER_ACCESS_TOKEN;
  const accountId = Number(env.CTRADER_ACCOUNT_ID);
  if (!clientId || !clientSecret || !accessToken || !Number.isFinite(accountId) || accountId <= 0) return null;
  return {
    clientId,
    clientSecret,
    accessToken,
    accountId,
    host: env.CTRADER_HOST || "demo.ctraderapi.com",
    port: Number(env.CTRADER_PORT) || 5036,
  };
}

// ---------------------------------------------------------------------------
// Encoding / decoding (pure, unit-tested)
// ---------------------------------------------------------------------------

/** int64 fields may arrive as JSON numbers or as strings; accept both. */
export function toInt(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function encodeEnvelope(payloadType: number, payload: Record<string, unknown>, clientMsgId?: string): string {
  const env: CTraderEnvelope = { payloadType, payload };
  if (clientMsgId) env.clientMsgId = clientMsgId;
  return JSON.stringify(env);
}

export function decodeEnvelope(raw: string): CTraderEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as CTraderEnvelope;
    if (!parsed || typeof parsed !== "object") return null;
    const payloadType = toInt(parsed.payloadType);
    if (payloadType == null) return null;
    return { clientMsgId: parsed.clientMsgId, payloadType, payload: (parsed.payload ?? {}) as Record<string, unknown> };
  } catch {
    return null;
  }
}

export const build = {
  applicationAuth: (cfg: CTraderConfig, id: string) => encodeEnvelope(CT.APPLICATION_AUTH_REQ, { clientId: cfg.clientId, clientSecret: cfg.clientSecret }, id),
  accountAuth: (cfg: CTraderConfig, id: string) => encodeEnvelope(CT.ACCOUNT_AUTH_REQ, { ctidTraderAccountId: cfg.accountId, accessToken: cfg.accessToken }, id),
  symbolsList: (accountId: number, id: string) => encodeEnvelope(CT.SYMBOLS_LIST_REQ, { ctidTraderAccountId: accountId, includeArchivedSymbols: false }, id),
  subscribeSpots: (accountId: number, symbolIds: number[], id: string) =>
    encodeEnvelope(CT.SUBSCRIBE_SPOTS_REQ, { ctidTraderAccountId: accountId, symbolId: symbolIds, subscribeToSpotTimestamp: true }, id),
  heartbeat: () => encodeEnvelope(CT.HEARTBEAT_EVENT, {}),
  getTrendbars: (accountId: number, symbolId: number, tf: Timeframe, fromMs: number, toMs: number, id: string, count?: number) =>
    encodeEnvelope(
      CT.GET_TRENDBARS_REQ,
      {
        ctidTraderAccountId: accountId,
        fromTimestamp: Math.floor(fromMs),
        toTimestamp: Math.floor(toMs),
        period: CTRADER_PERIOD[tf],
        symbolId,
        ...(count ? { count } : {}),
      },
      id,
    ),
};

/** "EUR/USD" -> "EURUSD", "XAUUSD.r" -> "XAUUSD.R" */
export function normalizeSymbolName(name: string): string {
  return name.replace(/[\s/_-]/g, "").toUpperCase();
}

export type LightSymbol = { symbolId: number; symbolName: string; enabled?: boolean };

export function decodeSymbolsList(payload: Record<string, unknown>): LightSymbol[] {
  const list = Array.isArray(payload.symbol) ? (payload.symbol as Record<string, unknown>[]) : [];
  const out: LightSymbol[] = [];
  for (const s of list) {
    const id = toInt(s.symbolId);
    if (id == null || typeof s.symbolName !== "string") continue;
    out.push({ symbolId: id, symbolName: s.symbolName, enabled: s.enabled === undefined ? undefined : Boolean(s.enabled) });
  }
  return out;
}

/** Maps the broker's symbol list onto our FeedSymbols (by normalized name). */
export function matchSymbols(list: LightSymbol[], wanted: FeedSymbol[]): { map: Map<number, FeedSymbol>; missing: string[] } {
  const byName = new Map<string, LightSymbol>();
  for (const s of list) {
    if (s.enabled === false) continue;
    byName.set(normalizeSymbolName(s.symbolName), s);
  }
  const map = new Map<number, FeedSymbol>();
  const missing: string[] = [];
  for (const w of wanted) {
    const hit = byName.get(normalizeSymbolName(w.feedSymbol)) ?? byName.get(normalizeSymbolName(w.symbol));
    if (hit) map.set(hit.symbolId, w);
    else missing.push(w.symbol);
  }
  return { map, missing };
}

export type QuoteCache = Map<number, { bid?: number; ask?: number }>;

/**
 * A spot event may carry only one side (the side that changed). We keep the
 * last known other side per symbol so every emitted tick has both.
 */
export function decodeSpotEvent(payload: Record<string, unknown>, symbols: Map<number, FeedSymbol>, cache: QuoteCache, now = Date.now()): Tick | null {
  const symbolId = toInt(payload.symbolId);
  if (symbolId == null) return null;
  const sym = symbols.get(symbolId);
  if (!sym) return null;
  const q = cache.get(symbolId) ?? {};
  const bidRaw = toInt(payload.bid);
  const askRaw = toInt(payload.ask);
  if (bidRaw != null) q.bid = bidRaw / CTRADER_PRICE_SCALE;
  if (askRaw != null) q.ask = askRaw / CTRADER_PRICE_SCALE;
  cache.set(symbolId, q);
  if (q.bid == null || q.ask == null) return null;
  const tsRaw = toInt(payload.timestamp);
  const ts = tsRaw != null && tsRaw > 1_000_000_000_000 ? tsRaw : now;
  const scale = 10 ** sym.digits;
  return {
    symbol: sym.symbol,
    bid: Math.round(q.bid * scale) / scale,
    ask: Math.round(q.ask * scale) / scale,
    ts,
    source: "CTRADER",
  };
}

/**
 * ProtoOATrendbar: low + deltaOpen/deltaHigh/deltaClose (all scaled 1e5),
 * utcTimestampInMinutes = bar open time in minutes since the epoch.
 */
export function decodeTrendbars(payload: Record<string, unknown>, digits = 5): Bar[] {
  const list = Array.isArray(payload.trendbar) ? (payload.trendbar as Record<string, unknown>[]) : [];
  const scale = 10 ** digits;
  const round = (v: number) => Math.round(v * scale) / scale;
  const bars: Bar[] = [];
  for (const tb of list) {
    const low = toInt(tb.low);
    const minutes = toInt(tb.utcTimestampInMinutes);
    if (low == null || minutes == null) continue;
    const dOpen = toInt(tb.deltaOpen) ?? 0;
    const dHigh = toInt(tb.deltaHigh) ?? 0;
    const dClose = toInt(tb.deltaClose) ?? 0;
    bars.push({
      time: minutes * 60_000,
      open: round((low + dOpen) / CTRADER_PRICE_SCALE),
      high: round((low + dHigh) / CTRADER_PRICE_SCALE),
      low: round(low / CTRADER_PRICE_SCALE),
      close: round((low + dClose) / CTRADER_PRICE_SCALE),
      volume: toInt(tb.volume) ?? 0,
    });
  }
  bars.sort((a, b) => a.time - b.time);
  return bars;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

type Pending = { resolve: (env: CTraderEnvelope) => void; reject: (err: Error) => void; timer: NodeJS.Timeout };

export class CTraderProvider implements MarketDataProvider {
  readonly name = "CTRADER";
  private listeners: ((t: Tick) => void)[] = [];
  private socket: WebSocket | null = null;
  private symbols: FeedSymbol[] = [];
  private symbolIds = new Map<number, FeedSymbol>();
  private symbolIdBySymbol = new Map<string, number>();
  private quoteCache: QuoteCache = new Map();
  private lastTickAt = new Map<string, number>();
  private connected = false;
  private authenticated = false;
  private stopping = false;
  private attempt = 0;
  private msgSeq = 0;
  private pending = new Map<string, Pending>();
  private heartbeat: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly log: FeedLogger;
  private readonly cfg: CTraderConfig | null;

  constructor(opts: { config?: CTraderConfig | null; log?: FeedLogger } = {}) {
    this.log = opts.log ?? silentLogger;
    this.cfg = opts.config === undefined ? readCTraderConfigFromEnv() : opts.config;
  }

  async start(symbols: FeedSymbol[]): Promise<void> {
    this.symbols = symbols;
    this.stopping = false;
    if (!this.cfg) {
      this.log.warn(
        {},
        "ctrader: CTRADER_CLIENT_ID / CTRADER_CLIENT_SECRET / CTRADER_ACCESS_TOKEN / CTRADER_ACCOUNT_ID are not all set - the cTrader feed will NOT start. Set FEED_SOURCES_OVERRIDE=STUB for local development.",
      );
      return;
    }
    if (symbols.length === 0) {
      this.log.warn({}, "ctrader: no symbols to subscribe");
      return;
    }
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.clearTimers();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("ctrader: provider stopped"));
    }
    this.pending.clear();
    const s = this.socket;
    this.socket = null;
    if (s) {
      try {
        s.terminate();
      } catch {
        // ignore
      }
    }
    this.connected = false;
    this.authenticated = false;
  }

  onTick(cb: (t: Tick) => void): void {
    this.listeners.push(cb);
  }

  health(): FeedHealth {
    const symbols: FeedHealth["symbols"] = {};
    let last: number | null = null;
    for (const s of this.symbols) {
      const at = this.lastTickAt.get(s.symbol) ?? null;
      symbols[s.symbol] = { lastTickAt: at };
      if (at && (!last || at > last)) last = at;
    }
    return { connected: this.connected && this.authenticated, lastTickAt: last, symbols };
  }

  async getBars(feedSymbol: string, tf: Timeframe, from: Date, to: Date): Promise<Bar[]> {
    if (!this.cfg) throw new Error("ctrader: not configured");
    const wanted = normalizeSymbolName(feedSymbol);
    let symbolId: number | undefined;
    let digits = 5;
    for (const [id, sym] of this.symbolIds) {
      if (normalizeSymbolName(sym.feedSymbol) === wanted || normalizeSymbolName(sym.symbol) === wanted) {
        symbolId = id;
        digits = sym.digits;
        break;
      }
    }
    if (symbolId === undefined) throw new Error(`ctrader: unknown symbol ${feedSymbol}`);
    const id = this.nextId();
    const res = await this.request(build.getTrendbars(this.cfg.accountId, symbolId, tf, from.getTime(), to.getTime(), id), id, 30_000);
    if (res.payloadType === CT.ERROR_RES || res.payloadType === CT.PROTO_ERROR_RES) {
      throw new Error(`ctrader: trendbars error ${String(res.payload?.errorCode)}: ${String(res.payload?.description ?? "")}`);
    }
    return decodeTrendbars(res.payload ?? {}, digits);
  }

  // -- internals -----------------------------------------------------------

  private nextId(): string {
    this.msgSeq += 1;
    return `mfx-${Date.now()}-${this.msgSeq}`;
  }

  private send(frame: string) {
    const s = this.socket;
    if (!s || s.readyState !== WebSocket.OPEN) throw new Error("ctrader: socket not open");
    s.send(frame);
  }

  private request(frame: string, id: string, timeoutMs: number): Promise<CTraderEnvelope> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ctrader: request ${id} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send(frame);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  private clearTimers() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeat = null;
    this.reconnectTimer = null;
  }

  private connect() {
    if (this.stopping || !this.cfg) return;
    const url = `wss://${this.cfg.host}:${this.cfg.port}`;
    this.log.info({ url, attempt: this.attempt }, "ctrader: connecting");
    const socket = new WebSocket(url, { handshakeTimeout: 15_000 });
    this.socket = socket;

    socket.on("open", () => {
      this.connected = true;
      this.attempt = 0;
      this.log.info({}, "ctrader: connected, authenticating application");
      this.heartbeat = setInterval(() => {
        try {
          this.send(build.heartbeat());
        } catch {
          // socket closed; the close handler reconnects
        }
      }, 10_000);
      void this.authenticateAndSubscribe().catch((err) => {
        this.log.error({ err: (err as Error).message }, "ctrader: session setup failed, reconnecting");
        socket.terminate();
      });
    });
    socket.on("message", (data) => this.handleFrame(data.toString()));
    socket.on("error", (err) => this.log.warn({ err: err.message }, "ctrader: socket error"));
    socket.on("close", (code, reason) => {
      this.connected = false;
      this.authenticated = false;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      if (this.socket === socket) this.socket = null;
      if (this.stopping) return;
      const delay = backoffDelay(this.attempt++);
      this.log.warn({ code, reason: reason.toString(), delay }, "ctrader: disconnected, reconnecting");
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });
  }

  private async authenticateAndSubscribe() {
    const cfg = this.cfg!;
    const appId = this.nextId();
    const appRes = await this.request(build.applicationAuth(cfg, appId), appId, 15_000);
    this.assertOk(appRes, "application auth");

    const accId = this.nextId();
    const accRes = await this.request(build.accountAuth(cfg, accId), accId, 15_000);
    this.assertOk(accRes, "account auth");
    this.authenticated = true;

    const listId = this.nextId();
    const listRes = await this.request(build.symbolsList(cfg.accountId, listId), listId, 30_000);
    this.assertOk(listRes, "symbols list");
    const { map, missing } = matchSymbols(decodeSymbolsList(listRes.payload ?? {}), this.symbols);
    if (missing.length > 0) this.log.warn({ missing }, "ctrader: symbols not offered by this account; they will not tick");
    this.symbolIds = map;
    this.symbolIdBySymbol = new Map(Array.from(map.entries()).map(([id, s]) => [s.symbol, id]));
    this.quoteCache.clear();
    if (map.size === 0) throw new Error("ctrader: none of the configured symbols exist on the account");

    const subId = this.nextId();
    const subRes = await this.request(build.subscribeSpots(cfg.accountId, Array.from(map.keys()), subId), subId, 15_000);
    this.assertOk(subRes, "subscribe spots");
    this.log.info({ symbols: Array.from(map.values()).map((s) => s.symbol) }, "ctrader: subscribed to spots");
  }

  private assertOk(env: CTraderEnvelope, step: string) {
    if (env.payloadType === CT.ERROR_RES || env.payloadType === CT.PROTO_ERROR_RES) {
      throw new Error(`ctrader: ${step} failed: ${String(env.payload?.errorCode)} ${String(env.payload?.description ?? "")}`);
    }
  }

  private handleFrame(raw: string) {
    const env = decodeEnvelope(raw);
    if (!env) {
      this.log.warn({ raw: raw.slice(0, 200) }, "ctrader: undecodable frame");
      return;
    }
    if (env.clientMsgId && this.pending.has(env.clientMsgId)) {
      const p = this.pending.get(env.clientMsgId)!;
      clearTimeout(p.timer);
      this.pending.delete(env.clientMsgId);
      p.resolve(env);
      return;
    }
    switch (env.payloadType) {
      case CT.SPOT_EVENT: {
        const tick = decodeSpotEvent(env.payload ?? {}, this.symbolIds, this.quoteCache);
        if (!tick) return;
        this.lastTickAt.set(tick.symbol, tick.ts);
        for (const cb of this.listeners) {
          try {
            cb(tick);
          } catch (err) {
            this.log.error({ err }, "ctrader: tick listener failed");
          }
        }
        return;
      }
      case CT.HEARTBEAT_EVENT:
        return;
      case CT.ACCOUNTS_TOKEN_INVALIDATED_EVENT:
      case CT.ACCOUNT_DISCONNECT_EVENT:
      case CT.CLIENT_DISCONNECT_EVENT:
        this.log.error({ payloadType: env.payloadType, payload: env.payload }, "ctrader: session invalidated by server, reconnecting");
        this.socket?.terminate();
        return;
      case CT.ERROR_RES:
      case CT.PROTO_ERROR_RES:
        this.log.error({ payload: env.payload }, "ctrader: error response");
        return;
      default:
        this.log.debug({ payloadType: env.payloadType }, "ctrader: unhandled message");
    }
  }

  /** Exposed for diagnostics (/status). */
  symbolIdFor(symbol: string): number | undefined {
    return this.symbolIdBySymbol.get(symbol);
  }
}
