import WebSocket from "ws";
import type { Tick } from "@/trading/protocol";
import { backoffDelay, silentLogger, type FeedHealth, type FeedLogger, type FeedSymbol, type MarketDataProvider } from "./types";

/**
 * Binance public market-data stream (no API key). Uses the combined
 * `bookTicker` stream, which pushes the best bid/ask on every change.
 * Docs: https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams
 */

export const BINANCE_STREAM_BASE = "wss://data-stream.binance.vision/stream";

export type BookTickerFrame = { stream: string; data: { s: string; b: string; a: string; u?: number } };

export function binanceStreamUrl(feedSymbols: string[], base = BINANCE_STREAM_BASE): string {
  const streams = feedSymbols.map((s) => `${s.toLowerCase()}@bookTicker`).join("/");
  return `${base}?streams=${streams}`;
}

/** Parses one combined-stream frame into a Tick (or null for non-bookTicker/unknown symbols). */
export function parseBookTicker(raw: string, map: Map<string, FeedSymbol>, now = Date.now()): Tick | null {
  let frame: BookTickerFrame;
  try {
    frame = JSON.parse(raw) as BookTickerFrame;
  } catch {
    return null;
  }
  const data = frame?.data;
  if (!data || typeof data.s !== "string" || typeof data.b !== "string" || typeof data.a !== "string") return null;
  const sym = map.get(data.s.toUpperCase());
  if (!sym) return null;
  const bid = Number(data.b);
  const ask = Number(data.a);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return null;
  return { symbol: sym.symbol, bid, ask, ts: now, source: "BINANCE" };
}

export class BinanceProvider implements MarketDataProvider {
  readonly name = "BINANCE";
  private listeners: ((t: Tick) => void)[] = [];
  private socket: WebSocket | null = null;
  private symbols: FeedSymbol[] = [];
  private byFeedSymbol = new Map<string, FeedSymbol>();
  private lastTickAt = new Map<string, number>();
  private connected = false;
  private stopping = false;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private lastMessageAt = 0;
  private readonly log: FeedLogger;

  constructor(private readonly opts: { url?: string; log?: FeedLogger; idleTimeoutMs?: number } = {}) {
    this.log = opts.log ?? silentLogger;
  }

  async start(symbols: FeedSymbol[]): Promise<void> {
    this.symbols = symbols;
    this.byFeedSymbol = new Map(symbols.map((s) => [s.feedSymbol.toUpperCase(), s]));
    this.stopping = false;
    if (symbols.length === 0) {
      this.log.warn({}, "binance: no symbols to subscribe");
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
    return { connected: this.connected, lastTickAt: last, symbols };
  }

  private connect() {
    if (this.stopping) return;
    const url = binanceStreamUrl(
      this.symbols.map((s) => s.feedSymbol),
      this.opts.url ?? BINANCE_STREAM_BASE,
    );
    this.log.info({ url, attempt: this.attempt }, "binance: connecting");
    const socket = new WebSocket(url, { handshakeTimeout: 10_000 });
    this.socket = socket;

    socket.on("open", () => {
      this.connected = true;
      this.attempt = 0;
      this.lastMessageAt = Date.now();
      this.log.info({}, "binance: connected");
      // Binance sends a ping frame every ~20 s and expects a pong (ws does
      // that automatically). If nothing at all arrives for idleTimeoutMs the
      // connection is dead: force a reconnect.
      const idle = this.opts.idleTimeoutMs ?? 60_000;
      this.watchdog = setInterval(() => {
        if (Date.now() - this.lastMessageAt > idle) {
          this.log.warn({}, "binance: idle timeout, reconnecting");
          socket.terminate();
        }
      }, 5_000);
    });
    socket.on("ping", () => {
      this.lastMessageAt = Date.now();
    });
    socket.on("message", (data) => {
      this.lastMessageAt = Date.now();
      const tick = parseBookTicker(data.toString(), this.byFeedSymbol, this.lastMessageAt);
      if (!tick) return;
      this.lastTickAt.set(tick.symbol, tick.ts);
      for (const cb of this.listeners) {
        try {
          cb(tick);
        } catch (err) {
          this.log.error({ err }, "binance: tick listener failed");
        }
      }
    });
    socket.on("error", (err) => {
      this.log.warn({ err: err.message }, "binance: socket error");
    });
    socket.on("close", (code, reason) => {
      this.connected = false;
      if (this.watchdog) clearInterval(this.watchdog);
      this.watchdog = null;
      if (this.socket === socket) this.socket = null;
      if (this.stopping) return;
      const delay = backoffDelay(this.attempt++);
      this.log.warn({ code, reason: reason.toString(), delay }, "binance: disconnected, reconnecting");
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });
  }
}
