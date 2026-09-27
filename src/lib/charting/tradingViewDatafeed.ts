import { channels, type Bar, type ServerMessage, type Timeframe } from "@/trading/protocol";

/**
 * TradingView Advanced Charts datafeed (JS API) over the EXISTING market-data
 * layer: history from GET /api/market/bars (the worker's candles), live bars
 * from the trading WebSocket `bars:<symbol>:<tf>` channel, symbols from
 * GET /api/market/instruments. Not wired into the UI yet: the terminal keeps
 * lightweight-charts until TradingView approves the licence and the
 * `charting_library` assets are added. Then:
 *
 *   new TradingView.widget({ datafeed: createTradingViewDatafeed({ socket, fetchJson }), symbol: "EURUSD", interval: "5", ... })
 *
 * Types are declared locally so nothing depends on the (not yet available) library.
 * Prices are the same the engine fills at, so the chart stays the price of record.
 */

/** TradingView resolution strings <-> our timeframes. */
export const RESOLUTION_TO_TIMEFRAME: Record<string, Timeframe> = { "1": "1m", "5": "5m", "15": "15m", "60": "1h", "240": "4h", "1D": "1d", D: "1d" };
export const SUPPORTED_RESOLUTIONS = ["1", "5", "15", "60", "240", "1D"];

export type TvBar = { time: number; open: number; high: number; low: number; close: number; volume?: number };
export type TvSymbolInfo = {
  name: string;
  ticker: string;
  description: string;
  type: string;
  session: string;
  timezone: string;
  exchange: string;
  listed_exchange: string;
  format: "price";
  minmov: number;
  pricescale: number;
  has_intraday: boolean;
  has_daily: boolean;
  supported_resolutions: string[];
  volume_precision: number;
  data_status: "streaming";
};
export type TvPeriodParams = { from: number; to: number; countBack: number; firstDataRequest: boolean };

type InstrumentRow = { symbol: string; displayName: string; category: string; digits: number };

export type DatafeedDeps = {
  /** GET helper returning parsed JSON (the browser session cookie authenticates it). */
  fetchJson: <T>(url: string) => Promise<T>;
  /** From useTradingSocket(). */
  socket: {
    subscribe: (channels: string[]) => void;
    unsubscribe: (channels: string[]) => void;
    onMessage: (handler: (msg: ServerMessage) => void) => () => void;
  };
};

const toMs = (t: number) => (t < 10_000_000_000 ? t * 1000 : t);

export function toTvBar(b: Bar): TvBar {
  return { time: toMs(b.time), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
}

export function symbolInfoFor(inst: InstrumentRow): TvSymbolInfo {
  const crypto = inst.category === "CRYPTO";
  return {
    name: inst.symbol,
    ticker: inst.symbol,
    description: inst.displayName,
    type: crypto ? "crypto" : "forex",
    // FX trades Sunday 22:00 - Friday 22:00 UTC; crypto 24/7. Display only: the engine enforces sessions.
    session: "24x7",
    timezone: "Etc/UTC",
    exchange: "MellaFx",
    listed_exchange: "MellaFx",
    format: "price",
    minmov: 1,
    pricescale: 10 ** inst.digits,
    has_intraday: true,
    has_daily: true,
    supported_resolutions: SUPPORTED_RESOLUTIONS,
    volume_precision: 0,
    data_status: "streaming",
  };
}

export function createTradingViewDatafeed(deps: DatafeedDeps) {
  let instruments: Promise<InstrumentRow[]> | null = null;
  const loadInstruments = () => (instruments ??= deps.fetchJson<InstrumentRow[]>("/api/market/instruments"));
  const listeners = new Map<string, { channel: string; off: () => void }>();

  return {
    onReady(cb: (config: { supported_resolutions: string[]; supports_marks: boolean; supports_time: boolean }) => void) {
      setTimeout(() => cb({ supported_resolutions: SUPPORTED_RESOLUTIONS, supports_marks: false, supports_time: true }), 0);
    },

    searchSymbols(input: string, _exchange: string, _type: string, onResult: (items: { symbol: string; full_name: string; description: string; exchange: string; type: string }[]) => void) {
      void loadInstruments().then((list) => {
        const q = input.toUpperCase();
        onResult(
          list
            .filter((i) => i.symbol.includes(q) || i.displayName.toUpperCase().includes(q))
            .map((i) => ({ symbol: i.symbol, full_name: i.symbol, description: i.displayName, exchange: "MellaFx", type: i.category === "CRYPTO" ? "crypto" : "forex" })),
        );
      });
    },

    resolveSymbol(name: string, onResolve: (info: TvSymbolInfo) => void, onError: (reason: string) => void) {
      void loadInstruments()
        .then((list) => {
          const inst = list.find((i) => i.symbol === name.toUpperCase().replace(/^MELLAFX:/, ""));
          if (inst) onResolve(symbolInfoFor(inst));
          else onError("unknown_symbol");
        })
        .catch(() => onError("instruments_unavailable"));
    },

    getBars(info: TvSymbolInfo, resolution: string, period: TvPeriodParams, onResult: (bars: TvBar[], meta: { noData: boolean }) => void, onError: (reason: string) => void) {
      const tf = RESOLUTION_TO_TIMEFRAME[resolution];
      if (!tf) return onError("unsupported_resolution");
      const limit = Math.min(1500, Math.max(1, period.countBack || 300));
      const qs = new URLSearchParams({ symbol: info.ticker, tf, limit: String(limit), before: String(period.to) });
      void deps
        .fetchJson<Bar[]>(`/api/market/bars?${qs.toString()}`)
        .then((rows) => {
          const bars = rows.map(toTvBar).filter((b) => b.time >= period.from * 1000);
          onResult(bars, { noData: rows.length === 0 });
        })
        .catch(() => onError("bars_unavailable"));
    },

    subscribeBars(info: TvSymbolInfo, resolution: string, onTick: (bar: TvBar) => void, listenerGuid: string) {
      const tf = RESOLUTION_TO_TIMEFRAME[resolution];
      if (!tf) return;
      const channel = channels.bars(info.ticker, tf);
      deps.socket.subscribe([channel]);
      const off = deps.socket.onMessage((msg) => {
        if (msg.type === "bar" && msg.symbol === info.ticker && msg.tf === tf) onTick(toTvBar(msg.bar));
      });
      listeners.set(listenerGuid, { channel, off });
    },

    unsubscribeBars(listenerGuid: string) {
      const l = listeners.get(listenerGuid);
      if (!l) return;
      l.off();
      listeners.delete(listenerGuid);
      // Keep the channel if another chart still listens to it.
      if (!Array.from(listeners.values()).some((x) => x.channel === l.channel)) deps.socket.unsubscribe([l.channel]);
    },
  };
}
