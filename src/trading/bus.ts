import { EventEmitter } from "node:events";
import type { AccountState, MarketState, PositionInfo, Tick, Timeframe, Bar } from "@/trading/protocol";

/**
 * In-process typed event bus between feeds, candle builder, engine and the
 * WebSocket gateway. When REDIS_URL is configured, ticks are also published
 * to `mfx:ticks` and account events to `mfx:account:<id>` so a second
 * gateway replica can fan them out; without Redis everything still works.
 */

export type PositionEvent = { accountId: string; event: "OPENED" | "CLOSED" | "MODIFIED"; position: PositionInfo; closeReason?: string; realizedPnl?: number };
export type OrderResultEvent = {
  accountId: string;
  clientOrderId: string;
  status: "FILLED" | "REJECTED" | "PENDING";
  orderId?: string;
  positionId?: string;
  filledPrice?: number;
  reason?: string;
};
export type MarketStatusEvent = { state: MarketState; reason?: string; symbols: Record<string, { lastTickAt: number | null; stale: boolean }> };
export type BarEvent = { symbol: string; tf: Timeframe; bar: Bar };

export type BusEvents = {
  tick: Tick;
  bar: BarEvent;
  account: AccountState;
  position: PositionEvent;
  "order.result": OrderResultEvent;
  "market.status": MarketStatusEvent;
};

type RedisLike = { publish: (channel: string, message: string) => Promise<unknown>; quit: () => Promise<unknown>; on: (ev: string, cb: (...a: unknown[]) => void) => unknown };

export const REDIS_TICK_CHANNEL = "mfx:ticks";
export const redisAccountChannel = (accountId: string) => `mfx:account:${accountId}`;

export class TradingBus {
  private emitter = new EventEmitter();
  private redis: RedisLike | null = null;
  private redisErrorLogged = false;

  constructor(private readonly log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void } = { info() {}, warn() {} }) {
    this.emitter.setMaxListeners(100);
  }

  /** Optional: attach a Redis publisher (ioredis is loaded lazily so tests never need it). */
  async connectRedis(url: string): Promise<void> {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    client.on("error", (err: unknown) => {
      if (!this.redisErrorLogged) {
        this.redisErrorLogged = true;
        this.log.warn({ err: (err as Error).message }, "bus: redis error (publishing disabled until it recovers)");
      }
    });
    client.on("ready", () => {
      this.redisErrorLogged = false;
      this.log.info({}, "bus: redis publisher ready");
    });
    await client.connect();
    this.redis = client as unknown as RedisLike;
  }

  async close(): Promise<void> {
    const r = this.redis;
    this.redis = null;
    if (r) await r.quit().catch(() => undefined);
    this.emitter.removeAllListeners();
  }

  on<K extends keyof BusEvents>(event: K, listener: (payload: BusEvents[K]) => void): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }

  off<K extends keyof BusEvents>(event: K, listener: (payload: BusEvents[K]) => void) {
    this.emitter.off(event, listener);
  }

  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]) {
    this.emitter.emit(event, payload);
    if (this.redis) {
      if (event === "tick") void this.redis.publish(REDIS_TICK_CHANNEL, JSON.stringify(payload)).catch(() => undefined);
      else if (event === "account" || event === "position" || event === "order.result") {
        const accountId = (payload as { accountId: string }).accountId;
        void this.redis.publish(redisAccountChannel(accountId), JSON.stringify({ event, payload })).catch(() => undefined);
      }
    }
  }
}
