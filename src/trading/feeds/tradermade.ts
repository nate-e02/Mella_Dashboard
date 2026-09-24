import WebSocket from "ws";
import type { Tick } from "@/trading/protocol";
import { backoffDelay, silentLogger, type FeedHealth, type FeedLogger, type FeedSymbol, type MarketDataProvider } from "./types";

/**
 * TraderMade streaming FX/CFD quotes (licensed; intended as the hot-standby
 * backup to cTrader). Docs: https://tradermade.com/docs/streaming-data-api
 *
 * Current protocol (default, wss://stream.tradermade.com/feedAdv):
 *   -> {"action":"login","key":KEY,"fmt":"JSON"}
 *   <- {"type":"login_ok","symbol_limit":54,...}
 *   -> {"action":"subscribe","symbols":["EURUSD:QUOTE",...],"send_last":true}
 *   <- {"type":"sub_ack","accepted":[...],"denied":[...],"invalid":[...]}
 *   <- {"t":"QUOTE"|"LAST_QUOTE","s":"EURUSD","b":"1.16270","a":"1.16272","ts":"20260515-12:36:35.588"}
 * Legacy protocol (selected when the URL is the old marketdata.tradermade.com/feedadv host):
 *   <- "Connected"
 *   -> {"userKey":KEY,"symbol":"EURUSD,GBPUSD"}
 *   <- {"symbol":"EURUSD","ts":"1614076641","bid":1.21469,"ask":1.2147,"mid":1.2146949}
 *
 * The server sends nothing on disconnect and has no application heartbeat,
 * so an idle watchdog forces a reconnect (with backoff) when the socket goes
 * quiet. Everything that touches the wire format is pure and unit-tested.
 */

export const TRADERMADE_STREAM_URL = "wss://stream.tradermade.com/feedAdv";

export type TraderMadeProtocol = "v2" | "legacy";

export function traderMadeProtocolFor(url: string): TraderMadeProtocol {
  return /marketdata\.tradermade\.com/i.test(url) ? "legacy" : "v2";
}

export const tmBuild = {
  login: (key: string) => JSON.stringify({ action: "login", key, fmt: "JSON" }),
  subscribe: (feedSymbols: string[]) => JSON.stringify({ action: "subscribe", symbols: feedSymbols.map((s) => `${normalizeTmSymbol(s)}:QUOTE`), send_last: true }),
  legacySubscribe: (key: string, feedSymbols: string[]) => JSON.stringify({ userKey: key, symbol: feedSymbols.map(normalizeTmSymbol).join(",") }),
};

/** "EUR/USD" -> "EURUSD", "eurusd:QUOTE" -> "EURUSD". */
export function normalizeTmSymbol(s: string): string {
  return s.replace(/:.*$/, "").replace(/[\s/_-]/g, "").toUpperCase();
}

export type TraderMadeMessage =
  | { kind: "tick"; tick: Tick }
  | { kind: "connected" }
  | { kind: "login_ok"; symbolLimit: number | null }
  | { kind: "sub_ack"; accepted: string[]; rejected: string[] }
  | { kind: "error"; reason: string }
  | { kind: "ignored" };

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Server timestamp -> epoch ms. Accepts "YYYYMMDD-HH:mm:ss.SSS" (read as UTC)
 * and epoch seconds/milliseconds (legacy). Null when unparseable.
 */
export function parseTmTimestamp(v: unknown): number | null {
  if (typeof v === "string") {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})-(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], Number((m[7] ?? "0").padEnd(3, "0")));
  }
  const n = num(v);
  if (n == null || n <= 0) return null;
  return n < 1e11 ? Math.round(n * 1000) : Math.round(n);
}

/** Largest server/receipt clock disagreement for which the server timestamp is trusted. */
const MAX_TS_SKEW_MS = 60_000;

/** Parses one text frame. `bySymbol` maps normalized TraderMade symbols to our FeedSymbols. */
export function parseTraderMadeMessage(raw: string, bySymbol: Map<string, FeedSymbol>, now = Date.now()): TraderMadeMessage {
  const text = raw.trim();
  if (!text.startsWith("{")) return /^connected/i.test(text) ? { kind: "connected" } : { kind: "ignored" };
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { kind: "ignored" };
  }
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return { kind: "ignored" };

  switch (msg.type) {
    case "login_ok":
      return { kind: "login_ok", symbolLimit: num(msg.symbol_limit) };
    case "sub_ack":
      return { kind: "sub_ack", accepted: strings(msg.accepted), rejected: [...strings(msg.denied), ...strings(msg.invalid)] };
    case "error":
      return { kind: "error", reason: typeof msg.reason === "string" ? msg.reason : "unknown" };
  }

  // v2 quote {t,s,b,a,ts} or legacy {symbol,bid,ask,ts}
  const isV2 = typeof msg.s === "string";
  if (isV2 && msg.t !== undefined && msg.t !== "QUOTE" && msg.t !== "LAST_QUOTE") return { kind: "ignored" };
  const rawSymbol = isV2 ? msg.s : msg.symbol;
  if (typeof rawSymbol !== "string") return { kind: "ignored" };
  const sym = bySymbol.get(normalizeTmSymbol(rawSymbol));
  if (!sym) return { kind: "ignored" };
  const bid = num(isV2 ? msg.b : msg.bid);
  const ask = num(isV2 ? msg.a : msg.ask);
  if (bid == null || ask == null || bid <= 0 || ask <= 0 || bid > ask) return { kind: "ignored" };
  const serverTs = parseTmTimestamp(msg.ts);
  const ts = serverTs != null && Math.abs(serverTs - now) <= MAX_TS_SKEW_MS ? serverTs : now;
  const scale = 10 ** sym.digits;
  return { kind: "tick", tick: { symbol: sym.symbol, bid: Math.round(bid * scale) / scale, ask: Math.round(ask * scale) / scale, ts, source: "TRADERMADE" } };
}

export class TraderMadeProvider implements MarketDataProvider {
  readonly name = "TRADERMADE";
  private listeners: ((t: Tick) => void)[] = [];
  private socket: WebSocket | null = null;
  private symbols: FeedSymbol[] = [];
  private bySymbol = new Map<string, FeedSymbol>();
  private lastTickAt = new Map<string, number>();
  private connected = false;
  private subscribed = false;
  private stopping = false;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private lastMessageAt = 0;
  private readonly log: FeedLogger;
  private readonly apiKey: string | null;
  private readonly url: string;
  private readonly protocol: TraderMadeProtocol;

  constructor(private readonly opts: { apiKey?: string | null; url?: string; log?: FeedLogger; idleTimeoutMs?: number } = {}) {
    this.log = opts.log ?? silentLogger;
    this.apiKey = opts.apiKey === undefined ? process.env.TRADERMADE_API_KEY || null : opts.apiKey;
    this.url = opts.url ?? (process.env.TRADERMADE_STREAM_URL || TRADERMADE_STREAM_URL);
    this.protocol = traderMadeProtocolFor(this.url);
  }

  async start(symbols: FeedSymbol[]): Promise<void> {
    this.symbols = symbols;
    this.bySymbol = new Map(symbols.map((s) => [normalizeTmSymbol(s.feedSymbol), s]));
    this.stopping = false;
    if (!this.apiKey) {
      this.log.warn({}, "tradermade: TRADERMADE_API_KEY is not set - the TraderMade feed will NOT start (symbols using it as primary or backup get no ticks from it)");
      return;
    }
    if (symbols.length === 0) {
      this.log.warn({}, "tradermade: no symbols to subscribe");
      return;
    }
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.reconnectTimer = null;
    this.watchdog = null;
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
    this.subscribed = false;
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
    return { connected: this.connected && this.subscribed, lastTickAt: last, symbols };
  }

  private send(socket: WebSocket, frame: string) {
    if (socket.readyState === WebSocket.OPEN) socket.send(frame);
  }

  private connect() {
    if (this.stopping || !this.apiKey) return;
    this.log.info({ url: this.url, protocol: this.protocol, attempt: this.attempt }, "tradermade: connecting");
    const socket = new WebSocket(this.url, { handshakeTimeout: 15_000 });
    this.socket = socket;
    const feedSymbols = this.symbols.map((s) => s.feedSymbol);

    socket.on("open", () => {
      this.connected = true;
      this.lastMessageAt = Date.now();
      if (this.protocol === "v2") this.send(socket, tmBuild.login(this.apiKey!));
      const idle = this.opts.idleTimeoutMs ?? 60_000;
      this.watchdog = setInterval(() => {
        if (Date.now() - this.lastMessageAt > idle) {
          this.log.warn({ idleMs: idle }, "tradermade: no data, reconnecting");
          socket.terminate();
        }
      }, 5_000);
    });
    socket.on("ping", () => {
      this.lastMessageAt = Date.now();
    });
    socket.on("message", (data) => {
      this.lastMessageAt = Date.now();
      const msg = parseTraderMadeMessage(data.toString(), this.bySymbol, this.lastMessageAt);
      switch (msg.kind) {
        case "tick": {
          this.attempt = 0;
          this.lastTickAt.set(msg.tick.symbol, msg.tick.ts);
          for (const cb of this.listeners) {
            try {
              cb(msg.tick);
            } catch (err) {
              this.log.error({ err }, "tradermade: tick listener failed");
            }
          }
          return;
        }
        case "connected":
          if (this.protocol === "legacy") {
            this.send(socket, tmBuild.legacySubscribe(this.apiKey!, feedSymbols));
            this.subscribed = true;
            this.log.info({ symbols: feedSymbols }, "tradermade: subscribed (legacy)");
          }
          return;
        case "login_ok":
          if (msg.symbolLimit != null && feedSymbols.length > msg.symbolLimit) {
            this.log.warn({ limit: msg.symbolLimit, wanted: feedSymbols.length }, "tradermade: more symbols than the plan allows; the excess will be denied");
          }
          this.send(socket, tmBuild.subscribe(feedSymbols));
          return;
        case "sub_ack":
          this.subscribed = msg.accepted.length > 0;
          if (msg.rejected.length > 0) this.log.warn({ rejected: msg.rejected }, "tradermade: symbols denied or invalid; they will not tick");
          this.log.info({ accepted: msg.accepted }, "tradermade: subscribed");
          return;
        case "error":
          this.log.error({ reason: msg.reason }, "tradermade: error from server");
          return;
        default:
          return;
      }
    });
    socket.on("error", (err) => this.log.warn({ err: err.message }, "tradermade: socket error"));
    socket.on("close", (code, reason) => {
      this.connected = false;
      this.subscribed = false;
      if (this.watchdog) clearInterval(this.watchdog);
      this.watchdog = null;
      if (this.socket === socket) this.socket = null;
      if (this.stopping) return;
      const delay = backoffDelay(this.attempt++);
      this.log.warn({ code, reason: reason.toString(), delay }, "tradermade: disconnected, reconnecting");
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });
  }
}
