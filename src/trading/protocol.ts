/**
 * Wire protocol shared by the trading worker (WebSocket gateway + engine)
 * and the browser terminal. JSON messages, one object per frame.
 *
 * Connection: `${WS_PUBLIC_URL}?ticket=<ticket>` (the URL is returned by the ticket endpoint) where the ticket is a
 * 60-second JWT minted by POST /api/trader/ws-ticket for the logged-in user.
 * The first server frame is `auth.ok` or `error` (then the socket closes).
 */

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
export const TIMEFRAME_SECONDS: Record<Timeframe, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };

export type Side = "BUY" | "SELL";
export type OrderKind = "MARKET" | "LIMIT" | "STOP";
export type MarketState = "OPEN" | "HALTED";

export type Tick = { symbol: string; bid: number; ask: number; ts: number; source: string };
/** `time` is the bucket start in unix SECONDS on the wire (what lightweight-charts expects). */
export type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number };

export type InstrumentInfo = {
  symbol: string;
  displayName: string;
  category: "FOREX" | "METAL" | "CRYPTO" | "INDEX";
  baseCurrency: string;
  quoteCurrency: string;
  digits: number;
  contractSize: number;
  minVolume: number;
  maxVolume: number;
  volumeStep: number;
  commissionPerLot: number;
};

export type PositionInfo = {
  id: string;
  accountId: string;
  symbol: string;
  side: Side;
  volume: number;
  entryPrice: number;
  currentPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  floatingPnl: number;
  marginUsed: number;
  openedAt: string;
};

export type AccountState = {
  accountId: string;
  status: string;
  currency: string;
  balance: number;
  equity: number;
  marginUsed: number;
  freeMargin: number;
  realizedPnl: number;
  floatingPnl: number;
  /** Equity captured at the last daily reset boundary */
  dailyAnchor: number;
  dailyLossUsed: number;
  dailyLossLimit: number;
  drawdownFloor: number;
  drawdownRemaining: number;
  profitTarget: number | null;
  profitProgress: number | null;
  tradingDays: number;
  minTradingDays: number;
  positions: PositionInfo[];
};

// ---- client -> server ----
export type ClientMessage =
  | { type: "subscribe"; channels: string[] }
  | { type: "unsubscribe"; channels: string[] }
  | {
      type: "order.place";
      accountId: string;
      clientOrderId: string;
      symbol: string;
      side: Side;
      orderType: OrderKind;
      volume: number;
      price?: number;
      stopLoss?: number;
      takeProfit?: number;
    }
  | { type: "position.close"; accountId: string; positionId: string; volume?: number }
  | { type: "position.modify"; accountId: string; positionId: string; stopLoss?: number | null; takeProfit?: number | null }
  | { type: "account.get"; accountId: string }
  | { type: "ping" };

// ---- server -> client ----
export type ServerMessage =
  | { type: "auth.ok"; userId: string; serverTime: number }
  | { type: "error"; code: string; message: string; ref?: string }
  | { type: "tick"; symbol: string; bid: number; ask: number; ts: number }
  | { type: "bar"; symbol: string; tf: Timeframe; bar: Bar }
  | { type: "account"; account: AccountState }
  | { type: "order.result"; clientOrderId: string; status: "FILLED" | "REJECTED" | "PENDING"; orderId?: string; positionId?: string; filledPrice?: number; reason?: string }
  | { type: "position"; accountId: string; event: "OPENED" | "CLOSED" | "MODIFIED"; position: PositionInfo; closeReason?: string; realizedPnl?: number }
  | { type: "market.status"; state: MarketState; reason?: string; symbols?: Record<string, { lastTickAt: number | null; stale: boolean }> }
  | { type: "pong"; serverTime: number };

/** Channel names */
export const channels = {
  ticks: (symbol: string) => `ticks:${symbol}`,
  bars: (symbol: string, tf: Timeframe) => `bars:${symbol}:${tf}`,
  account: (accountId: string) => `account:${accountId}`,
  market: "market",
};

/** Feed silence after which the market is treated as halted (no fills, no breach evaluation). */
export const FEED_STALE_MS = 5000;
/** Browser fan-out cap per symbol */
export const CLIENT_TICK_RATE_PER_SEC = 10;
