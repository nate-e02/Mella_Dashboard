"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useToast } from "@/components/ui/Toast";
import { useLocale, useT } from "@/i18n/client";
import { useTradingSocket } from "@/lib/hooks/useTradingSocket";
import type { AccountMeta } from "@/lib/services/accountState";
import { TIMEFRAMES, channels, type AccountState, type InstrumentInfo, type PositionInfo, type ServerMessage, type Timeframe } from "@/trading/protocol";
import { signedEtb } from "@/components/trader/dashboard/money";
import { AccountBar } from "./AccountBar";
import { InstrumentList } from "./InstrumentList";
import { OrderTicket, type OrderDraft } from "./OrderTicket";
import { PositionsPanel, type ClosedTodaySummary } from "./PositionsPanel";
import { PriceChart } from "./PriceChart";
import { RuleBanners } from "./RuleBanners";
import { closeReasonLabel, rejectMessage } from "./messages";
import { ruleNotices, ruleRestriction } from "./rules";
import { formatPrice } from "./tradingMath";
import { useClock } from "./useClock";

const PREF_KEYS = { account: "mellafx:trade:account", symbol: "mellafx:trade:symbol", tf: "mellafx:trade:tf" } as const;
const DEFAULT_TF: Timeframe = "5m";

// The trader's last account/symbol/timeframe live in localStorage and are read
// through useSyncExternalStore: the server snapshot is null, so SSR and
// hydration agree, and the real value arrives without an effect copying it.
const prefListeners = new Set<() => void>();
function subscribePrefs(listener: () => void) {
  prefListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    prefListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private mode / quota: the in-memory fallback below still applies
  }
  memoryPrefs.set(key, value);
  for (const listener of prefListeners) listener();
}
const memoryPrefs = new Map<string, string>();
function usePref(key: string): string | null {
  return useSyncExternalStore(
    subscribePrefs,
    () => memoryPrefs.get(key) ?? readPref(key),
    () => null,
  );
}
/** False during SSR and hydration, true afterwards; gates client-only fetches until prefs are known. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

/** UUID v4 with a fallback for non-secure (plain http LAN) contexts where crypto.randomUUID is unavailable. */
function newClientOrderId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function applyPositionEvent(positions: PositionInfo[], msg: Extract<ServerMessage, { type: "position" }>): PositionInfo[] {
  switch (msg.event) {
    case "OPENED":
      return positions.some((p) => p.id === msg.position.id) ? positions.map((p) => (p.id === msg.position.id ? msg.position : p)) : [...positions, msg.position];
    case "MODIFIED":
      return positions.map((p) => (p.id === msg.position.id ? msg.position : p));
    case "CLOSED":
      return positions.filter((p) => p.id !== msg.position.id);
    default:
      return positions;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export function TradeTerminal({
  accounts,
  instruments,
  fxRates,
}: {
  accounts: AccountMeta[];
  instruments: InstrumentInfo[];
  fxRates: Record<string, number>;
}) {
  const toast = useToast();
  const t = useT();
  const locale = useLocale();
  const now = useClock();
  const socket = useTradingSocket({ enabled: accounts.length > 0 && instruments.length > 0 });
  const { status, marketState, lastTick, lowData, subscribe, unsubscribe, onMessage, request, send } = socket;

  const instrumentMap = useMemo(() => new Map(instruments.map((i) => [i.symbol, i])), [instruments]);

  const hydrated = useHydrated();
  const storedAccount = usePref(PREF_KEYS.account);
  const storedSymbol = usePref(PREF_KEYS.symbol);
  const storedTf = usePref(PREF_KEYS.tf);

  const accountId = storedAccount && accounts.some((a) => a.id === storedAccount) ? storedAccount : (accounts[0]?.id ?? "");
  const symbol = storedSymbol && instrumentMap.has(storedSymbol) ? storedSymbol : (instruments[0]?.symbol ?? "");
  const timeframe: Timeframe = storedTf && TIMEFRAMES.includes(storedTf as Timeframe) ? (storedTf as Timeframe) : DEFAULT_TF;

  // Account state and the closed-today summary are keyed by account id, so a
  // switch simply derives "not loaded yet" instead of clearing state in an effect.
  const [stateFor, setStateFor] = useState<{ id: string; state: AccountState } | null>(null);
  const [closedFor, setClosedFor] = useState<{ id: string; summary: ClosedTodaySummary } | null>(null);
  const accountState = stateFor?.id === accountId ? stateFor.state : null;
  const closedToday = closedFor?.id === accountId ? closedFor.summary : null;

  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];
  const instrument = instrumentMap.get(symbol);

  const selectAccount = useCallback((id: string) => writePref(PREF_KEYS.account, id), []);
  const selectSymbol = useCallback((s: string) => writePref(PREF_KEYS.symbol, s), []);
  const selectTimeframe = useCallback((tf: Timeframe) => writePref(PREF_KEYS.tf, tf), []);

  const refreshClosedToday = useCallback((id: string) => {
    fetchJson<ClosedTodaySummary>(`/api/trader/accounts/${id}/positions?status=CLOSED`)
      .then((summary) => setClosedFor({ id, summary }))
      .catch(() => undefined);
  }, []);

  // Initial state from the database so the page is complete before the socket connects.
  useEffect(() => {
    if (!hydrated || !accountId) return;
    let cancelled = false;
    const id = accountId;
    fetchJson<AccountState>(`/api/trader/accounts/${id}/state`)
      .then((state) => {
        if (!cancelled) setStateFor({ id, state });
      })
      .catch(() => {
        if (!cancelled) toast.push(t("trading.toast.loadStateFailed"), "error");
      });
    fetchJson<ClosedTodaySummary>(`/api/trader/accounts/${id}/positions?status=CLOSED`)
      .then((summary) => {
        if (!cancelled) setClosedFor({ id, summary });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hydrated, accountId, toast, t]);

  // Channel subscriptions: market status, this account, and ticks. In low-data
  // mode only the selected symbol and open-position symbols stream.
  useEffect(() => {
    if (!accountId) return;
    const chans = [channels.market, channels.account(accountId)];
    subscribe(chans);
    return () => unsubscribe(chans);
  }, [accountId, subscribe, unsubscribe]);

  const positionSymbols = useMemo(() => Array.from(new Set((accountState?.positions ?? []).map((p) => p.symbol))), [accountState?.positions]);
  const tickSymbols = useMemo(() => {
    if (!lowData) return instruments.map((i) => i.symbol);
    return Array.from(new Set([symbol, ...positionSymbols].filter(Boolean)));
  }, [lowData, instruments, symbol, positionSymbols]);

  const tickSubsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const wanted = new Set(tickSymbols.map((s) => channels.ticks(s)));
    const current = tickSubsRef.current;
    const add = Array.from(wanted).filter((c) => !current.has(c));
    const remove = Array.from(current).filter((c) => !wanted.has(c));
    if (add.length) subscribe(add);
    if (remove.length) unsubscribe(remove);
    tickSubsRef.current = wanted;
  }, [tickSymbols, subscribe, unsubscribe]);
  useEffect(() => {
    const subs = tickSubsRef;
    return () => {
      if (subs.current.size) unsubscribe(Array.from(subs.current));
      subs.current = new Set();
    };
  }, [unsubscribe]);

  // Ask for a fresh account snapshot every time the socket (re)authenticates.
  useEffect(() => {
    if (status === "open" && accountId) send({ type: "account.get", accountId });
  }, [status, accountId, send]);

  // Orders this page is waiting on through request(): their order.result is handled there, not below.
  const awaitingRef = useRef<Set<string>>(new Set());

  // Live account/position updates.
  useEffect(() => {
    return onMessage((msg) => {
      if (msg.type === "account") {
        if (msg.account.accountId === accountId) setStateFor({ id: accountId, state: msg.account });
        return;
      }
      if (msg.type === "position") {
        if (msg.accountId !== accountId) return;
        setStateFor((prev) => (prev && prev.id === accountId ? { id: accountId, state: { ...prev.state, positions: applyPositionEvent(prev.state.positions, msg) } } : prev));
        if (msg.event === "CLOSED") {
          refreshClosedToday(accountId);
          if (msg.closeReason && msg.closeReason !== "MANUAL") {
            const pnl = msg.realizedPnl != null ? ` (${signedEtb(msg.realizedPnl)})` : "";
            toast.push(
              t("trading.toast.autoClosed", { symbol: msg.position.symbol, side: t(msg.position.side === "BUY" ? "trading.side.BUY" : "trading.side.SELL"), reason: closeReasonLabel(t, msg.closeReason), pnl }),
              msg.realizedPnl != null && msg.realizedPnl < 0 ? "error" : "info",
            );
          }
        }
        return;
      }
      // Pending orders filled or cancelled by the server (trigger, weekend rule, account closed).
      if (msg.type === "order.result" && !awaitingRef.current.has(msg.clientOrderId)) {
        if (msg.status === "FILLED") toast.push(t("trading.toast.pendingFilled"), "success");
        else if (msg.status === "REJECTED") toast.push(t("trading.toast.pendingCancelled", { reason: rejectMessage(t, msg.reason) }), "info");
        return;
      }
      if (msg.type === "error" && !msg.ref && statusRef.current === "open") {
        toast.push(rejectMessage(t, msg.code, msg.message || t("trading.toast.serverError")), "error");
      }
    });
  }, [onMessage, accountId, refreshClosedToday, toast, t]);

  // ---- actions -----------------------------------------------------------

  const placeOrder = useCallback(
    async (draft: OrderDraft) => {
      if (!account) return;
      const clientOrderId = newClientOrderId();
      awaitingRef.current.add(clientOrderId);
      try {
        const result = await request(
          {
            type: "order.place",
            accountId: account.id,
            clientOrderId,
            symbol: draft.symbol,
            side: draft.side,
            orderType: draft.orderType,
            volume: draft.volume,
            ...(draft.price != null ? { price: draft.price } : {}),
            ...(draft.stopLoss != null ? { stopLoss: draft.stopLoss } : {}),
            ...(draft.takeProfit != null ? { takeProfit: draft.takeProfit } : {}),
          },
          (m) => (m.type === "order.result" && m.clientOrderId === clientOrderId) || (m.type === "error" && m.ref === clientOrderId),
          15_000,
        );
        if (result.type === "error") {
          toast.push(t("trading.toast.rejected", { reason: rejectMessage(t, result.code, result.message) }), "error");
          return;
        }
        if (result.type !== "order.result") return;
        const digits = instrumentMap.get(draft.symbol)?.digits ?? 5;
        const side = t(draft.side === "BUY" ? "trading.side.BUY" : "trading.side.SELL");
        if (result.status === "FILLED") {
          toast.push(
            result.filledPrice != null
              ? t("trading.toast.filledAt", { side, volume: draft.volume, symbol: draft.symbol, price: formatPrice(result.filledPrice, digits) })
              : t("trading.toast.filled", { side, volume: draft.volume, symbol: draft.symbol }),
            "success",
          );
        } else if (result.status === "PENDING") {
          toast.push(t("trading.toast.pendingPlaced", { type: t(draft.orderType === "LIMIT" ? "trading.orderType.LIMIT" : "trading.orderType.STOP"), symbol: draft.symbol }), "info");
        } else {
          toast.push(t("trading.toast.rejected", { reason: rejectMessage(t, result.reason) }), "error");
        }
      } catch (err) {
        toast.push(err instanceof Error ? err.message : t("trading.toast.orderFailed"), "error");
      } finally {
        awaitingRef.current.delete(clientOrderId);
      }
    },
    [account, request, toast, instrumentMap, t],
  );

  const closePosition = useCallback(
    async (positionId: string, volume?: number) => {
      if (!account) return;
      try {
        const result = await request(
          { type: "position.close", accountId: account.id, positionId, ...(volume != null ? { volume } : {}) },
          (m) =>
            (m.type === "position" && m.position.id === positionId && (m.event === "CLOSED" || m.event === "MODIFIED")) ||
            (m.type === "error" && (m.ref === positionId || m.ref === undefined)),
          15_000,
        );
        if (result.type === "error") toast.push(rejectMessage(t, result.code, result.message || t("trading.toast.closeFailed")), "error");
        else if (result.type === "position" && result.event === "CLOSED") {
          toast.push(
            t("trading.toast.closed", { symbol: result.position.symbol, pnl: result.realizedPnl != null ? signedEtb(result.realizedPnl) : "" }).trim(),
            result.realizedPnl != null && result.realizedPnl < 0 ? "info" : "success",
          );
        } else if (result.type === "position") {
          toast.push(t("trading.toast.partiallyClosed", { symbol: result.position.symbol, volume: result.position.volume }), "success");
        }
      } catch (err) {
        toast.push(err instanceof Error ? err.message : t("trading.toast.closeFailed"), "error");
      }
    },
    [account, request, toast, t],
  );

  const modifyPosition = useCallback(
    async (positionId: string, risk: { stopLoss?: number | null; takeProfit?: number | null }): Promise<boolean> => {
      if (!account) return false;
      let result: ServerMessage;
      try {
        result = await request(
          { type: "position.modify", accountId: account.id, positionId, ...risk },
          (m) => (m.type === "position" && m.position.id === positionId && m.event === "MODIFIED") || (m.type === "error" && (m.ref === positionId || m.ref === undefined)),
          10_000,
        );
      } catch (err) {
        toast.push(err instanceof Error ? err.message : t("trading.toast.updateFailed"), "error");
        return false;
      }
      if (result.type === "error") {
        toast.push(rejectMessage(t, result.code, result.message || t("trading.toast.updateFailed")), "error");
        return false;
      }
      toast.push(t("trading.toast.positionUpdated"), "success");
      return true;
    },
    [account, request, toast, t],
  );

  const notices = useMemo(
    () => (account && now != null ? ruleNotices(account.rules, instruments, marketState?.news, now, symbol) : []),
    [account, instruments, marketState?.news, now, symbol],
  );

  if (!account || !instrument) return null;

  const positions = accountState?.positions ?? [];
  const actionsDisabled = status !== "open" || !account.tradable;
  const restriction = now != null ? ruleRestriction(account.rules, instrument, marketState?.news, now) : null;

  return (
    <div className="flex flex-col gap-3">
      <RuleBanners notices={notices} locale={locale} />
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr] lg:items-start">
        {/* Account summary: sticky at the top on phones, right rail on desktop */}
        <div className="sticky top-[57px] z-20 lg:static lg:col-start-3 lg:row-start-1">
          <AccountBar
            account={account}
            state={accountState}
            marketState={marketState}
            socketStatus={status}
            lastError={socket.lastError}
            onReconnect={socket.reconnect}
            lowData={lowData}
            onToggleLowData={socket.setLowData}
          />
        </div>

        <div className="lg:col-start-1 lg:row-start-1 lg:row-span-2">
          <InstrumentList instruments={instruments} selected={symbol} onSelect={selectSymbol} lastTick={lastTick} marketState={marketState} />
        </div>

        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <PriceChart
            symbol={symbol}
            instrument={instrument}
            timeframe={timeframe}
            onTimeframeChange={selectTimeframe}
            subscribe={subscribe}
            unsubscribe={unsubscribe}
            onMessage={onMessage}
            socketStatus={status}
          />
        </div>

        <div className="lg:col-start-3 lg:row-start-2">
          <OrderTicket
            key={symbol}
            accounts={accounts}
            account={account}
            onAccountChange={selectAccount}
            instrument={instrument}
            tick={lastTick.get(symbol)}
            state={accountState}
            fxRates={fxRates}
            marketState={marketState}
            socketStatus={status}
            restriction={restriction}
            onPlaceOrder={placeOrder}
          />
        </div>

        <div className="min-w-0 lg:col-start-2 lg:row-start-2">
          <PositionsPanel
            positions={positions}
            instruments={instrumentMap}
            lastTick={lastTick}
            closedToday={closedToday}
            disabled={actionsDisabled}
            onClose={closePosition}
            onModify={modifyPosition}
          />
        </div>
      </div>
    </div>
  );
}
