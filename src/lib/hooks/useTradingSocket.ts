"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ClientMessage, MarketState, ServerMessage, Tick } from "@/trading/protocol";

/**
 * One WebSocket per page to the trading worker.
 *
 * - Fetches a 60 s ticket from POST /api/trader/ws-ticket for every connect
 *   (tickets are single-use and short-lived, so reconnects always mint a new one).
 * - Reconnects with exponential backoff (1 s .. 30 s + jitter) and re-sends
 *   every subscription the page still holds once `auth.ok` arrives.
 * - `request()` sends a message and resolves with the first server frame the
 *   matcher accepts (e.g. the `order.result` carrying our clientOrderId).
 * - Tick state handed to React is coalesced: at most 10 updates/s normally
 *   and 2/s in low-data mode (Data Saver header or the user's toggle), while
 *   `onMessage` handlers still see every frame for things like the chart.
 */

export type SocketStatus = "connecting" | "open" | "closed" | "error";

export type MarketStatus = {
  state: MarketState;
  reason?: string;
  symbols?: Record<string, { lastTickAt: number | null; stale: boolean }>;
  receivedAt: number;
};

export type MessageHandler = (msg: ServerMessage) => void;

export type TradingSocket = {
  status: SocketStatus;
  /** Last `market.status` frame, or null before the first one. */
  marketState: MarketStatus | null;
  /** Latest tick per symbol (throttled snapshot). */
  lastTick: Map<string, Tick>;
  /** Human-readable reason for the last error/close, if any. */
  lastError: string | null;
  /** Current reconnect attempt (0 while connected). */
  attempt: number;
  lowData: boolean;
  setLowData: (value: boolean) => void;
  subscribe: (channels: string[]) => void;
  unsubscribe: (channels: string[]) => void;
  /** Fire-and-forget send; returns false when the socket is not open. */
  send: (msg: ClientMessage) => boolean;
  /** Register a handler for every server frame; returns the unsubscribe function. */
  onMessage: (handler: MessageHandler) => () => void;
  /** Send and wait for the first matching frame (rejects on timeout or disconnect). */
  request: <T extends ServerMessage = ServerMessage>(
    msg: ClientMessage,
    matcher: (m: ServerMessage) => boolean,
    timeoutMs?: number,
  ) => Promise<T>;
  /** Drop the current socket and reconnect right away. */
  reconnect: () => void;
};

type Pending = {
  matcher: (m: ServerMessage) => boolean;
  resolve: (m: ServerMessage) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

const TICKET_ENDPOINT = "/api/trader/ws-ticket";
const PING_INTERVAL_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;
const NORMAL_FLUSH_MS = 100;
const LOW_DATA_FLUSH_MS = 500;
const LOW_DATA_STORAGE_KEY = "mellafx:lowData";

function detectSaveData(): boolean {
  if (typeof navigator === "undefined") return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(conn?.saveData);
}

function readStoredLowData(): boolean | null {
  try {
    const raw = window.localStorage.getItem(LOW_DATA_STORAGE_KEY);
    return raw === null ? null : raw === "1";
  } catch {
    return null;
  }
}

// Low-data preference lives in localStorage and is read through
// useSyncExternalStore so the server render (false) and the client value never
// disagree during hydration and no effect has to copy it into state.
const lowDataListeners = new Set<() => void>();
function subscribeLowData(listener: () => void) {
  lowDataListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    lowDataListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
function getLowDataSnapshot(): boolean {
  return readStoredLowData() ?? detectSaveData();
}
function getLowDataServerSnapshot(): boolean {
  return false;
}

export function useTradingSocket(options: { enabled?: boolean } = {}): TradingSocket {
  const enabled = options.enabled ?? true;

  const [socketStatus, setStatus] = useState<SocketStatus>("connecting");
  const status: SocketStatus = enabled ? socketStatus : "closed";
  const [marketState, setMarketState] = useState<MarketStatus | null>(null);
  const [lastTick, setLastTick] = useState<Map<string, Tick>>(() => new Map());
  const [lastError, setLastError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const lowData = useSyncExternalStore(subscribeLowData, getLowDataSnapshot, getLowDataServerSnapshot);

  const wsRef = useRef<WebSocket | null>(null);
  const authedRef = useRef(false);
  const stoppedRef = useRef(!enabled);
  const generationRef = useRef(0);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const subsRef = useRef<Set<string>>(new Set());
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const pendingRef = useRef<Set<Pending>>(new Set());
  const tickBufferRef = useRef<Map<string, Tick>>(new Map());
  const tickDirtyRef = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lowDataRef = useRef(false);

  // The flush timer reads the current preference without re-creating callbacks.
  useEffect(() => {
    lowDataRef.current = lowData;
  }, [lowData]);

  const setLowData = useCallback((value: boolean) => {
    lowDataRef.current = value;
    try {
      window.localStorage.setItem(LOW_DATA_STORAGE_KEY, value ? "1" : "0");
    } catch {
      // storage unavailable (private mode); fall through so the snapshot still updates
    }
    for (const listener of lowDataListeners) listener();
  }, []);

  const scheduleTickFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(
      () => {
        flushTimerRef.current = null;
        if (!tickDirtyRef.current) return;
        tickDirtyRef.current = false;
        setLastTick(new Map(tickBufferRef.current));
      },
      lowDataRef.current ? LOW_DATA_FLUSH_MS : NORMAL_FLUSH_MS,
    );
  }, []);

  const rejectAllPending = useCallback((reason: string) => {
    for (const p of pendingRef.current) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    pendingRef.current.clear();
  }, []);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }, []);

  const rawSend = useCallback((msg: ClientMessage): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }, []);

  const dispatch = useCallback((msg: ServerMessage) => {
    for (const p of Array.from(pendingRef.current)) {
      let matched = false;
      try {
        matched = p.matcher(msg);
      } catch {
        matched = false;
      }
      if (matched) {
        pendingRef.current.delete(p);
        if (p.timer) clearTimeout(p.timer);
        p.resolve(msg);
      }
    }
    for (const handler of Array.from(handlersRef.current)) {
      try {
        handler(msg);
      } catch (err) {
        console.error("trading socket handler failed", err);
      }
    }
  }, []);

  // `connect` and `scheduleReconnect` reference each other; keep them in refs.
  const connectRef = useRef<() => void>(() => undefined);

  const scheduleReconnect = useCallback(() => {
    if (stoppedRef.current || reconnectTimerRef.current) return;
    attemptRef.current += 1;
    setAttempt(attemptRef.current);
    const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attemptRef.current - 1));
    const delay = base + Math.floor(Math.random() * 500);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connectRef.current();
    }, delay);
  }, []);

  const connect = useCallback(async () => {
    if (stoppedRef.current || typeof window === "undefined") return;
    const generation = ++generationRef.current;
    const previous = wsRef.current;
    if (previous) {
      wsRef.current = null;
      try {
        previous.close();
      } catch {
        // ignore
      }
    }
    authedRef.current = false;
    setStatus("connecting");

    let ticket: { ticket: string; wsUrl: string };
    try {
      const res = await fetch(TICKET_ENDPOINT, { method: "POST", credentials: "same-origin", cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 401 ? "Your session has expired. Please log in again." : `Ticket request failed (${res.status})`);
      ticket = (await res.json()) as { ticket: string; wsUrl: string };
    } catch (err) {
      if (generation !== generationRef.current || stoppedRef.current) return;
      setLastError(err instanceof Error ? err.message : "Could not get a connection ticket");
      setStatus("error");
      scheduleReconnect();
      return;
    }
    if (generation !== generationRef.current || stoppedRef.current) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(`${ticket.wsUrl}?ticket=${encodeURIComponent(ticket.ticket)}`);
    } catch (err) {
      setLastError(err instanceof Error ? err.message : "Could not open the trading connection");
      setStatus("error");
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.onmessage = (event: MessageEvent) => {
      if (wsRef.current !== ws) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return;

      switch (msg.type) {
        case "auth.ok": {
          authedRef.current = true;
          attemptRef.current = 0;
          setAttempt(0);
          setLastError(null);
          setStatus("open");
          if (subsRef.current.size > 0) rawSend({ type: "subscribe", channels: Array.from(subsRef.current) });
          if (pingTimerRef.current) clearInterval(pingTimerRef.current);
          pingTimerRef.current = setInterval(() => rawSend({ type: "ping" }), PING_INTERVAL_MS);
          break;
        }
        case "error": {
          if (!authedRef.current) setLastError(msg.message || "The trading server rejected the connection");
          break;
        }
        case "tick": {
          tickBufferRef.current.set(msg.symbol, { symbol: msg.symbol, bid: msg.bid, ask: msg.ask, ts: msg.ts, source: "ws" });
          tickDirtyRef.current = true;
          scheduleTickFlush();
          break;
        }
        case "market.status": {
          setMarketState({ state: msg.state, reason: msg.reason, symbols: msg.symbols, receivedAt: Date.now() });
          break;
        }
        default:
          break;
      }
      dispatch(msg);
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      setLastError((prev) => prev ?? "Trading connection error");
      setStatus("error");
    };

    ws.onclose = (event: CloseEvent) => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      authedRef.current = false;
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      rejectAllPending("Trading connection closed");
      if (stoppedRef.current) return;
      if (event.reason) setLastError(event.reason);
      setStatus(event.code === 1000 ? "closed" : "error");
      scheduleReconnect();
    };
  }, [dispatch, rawSend, rejectAllPending, scheduleReconnect, scheduleTickFlush]);

  useEffect(() => {
    connectRef.current = () => {
      void connect();
    };
  }, [connect]);

  // Lifecycle: connect while enabled, tear down on unmount / disable.
  useEffect(() => {
    if (!enabled) {
      stoppedRef.current = true;
      return;
    }
    stoppedRef.current = false;
    connectRef.current();

    const onVisible = () => {
      if (document.visibilityState !== "visible" || stoppedRef.current) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        connectRef.current();
      }
    };
    const onOnline = () => onVisible();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    return () => {
      stoppedRef.current = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      clearTimers();
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      rejectAllPending("Trading connection closed");
      const ws = wsRef.current;
      wsRef.current = null;
      generationRef.current += 1;
      if (ws) {
        try {
          ws.close(1000, "page closed");
        } catch {
          // ignore
        }
      }
    };
  }, [enabled, clearTimers, rejectAllPending]);

  const subscribe = useCallback(
    (channelList: string[]) => {
      const fresh = channelList.filter((c) => !subsRef.current.has(c));
      for (const c of fresh) subsRef.current.add(c);
      if (fresh.length > 0 && authedRef.current) rawSend({ type: "subscribe", channels: fresh });
    },
    [rawSend],
  );

  const unsubscribe = useCallback(
    (channelList: string[]) => {
      const present = channelList.filter((c) => subsRef.current.has(c));
      for (const c of present) subsRef.current.delete(c);
      if (present.length > 0 && authedRef.current) rawSend({ type: "unsubscribe", channels: present });
    },
    [rawSend],
  );

  const send = useCallback((msg: ClientMessage) => (authedRef.current ? rawSend(msg) : false), [rawSend]);

  const onMessage = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const request = useCallback(
    <T extends ServerMessage = ServerMessage>(msg: ClientMessage, matcher: (m: ServerMessage) => boolean, timeoutMs = 10_000) =>
      new Promise<T>((resolve, reject) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN || !authedRef.current) {
          reject(new Error("Not connected to the trading server"));
          return;
        }
        const entry: Pending = {
          matcher,
          resolve: (m) => resolve(m as T),
          reject,
          timer: null,
        };
        entry.timer = setTimeout(() => {
          pendingRef.current.delete(entry);
          reject(new Error("The trading server did not respond in time"));
        }, timeoutMs);
        pendingRef.current.add(entry);
        if (!rawSend(msg)) {
          pendingRef.current.delete(entry);
          if (entry.timer) clearTimeout(entry.timer);
          reject(new Error("Could not send to the trading server"));
        }
      }),
    [rawSend],
  );

  const reconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    attemptRef.current = 0;
    setAttempt(0);
    stoppedRef.current = false;
    connectRef.current();
  }, []);

  return useMemo(
    () => ({
      status,
      marketState,
      lastTick,
      lastError,
      attempt,
      lowData,
      setLowData,
      subscribe,
      unsubscribe,
      send,
      onMessage,
      request,
      reconnect,
    }),
    [status, marketState, lastTick, lastError, attempt, lowData, setLowData, subscribe, unsubscribe, send, onMessage, request, reconnect],
  );
}
