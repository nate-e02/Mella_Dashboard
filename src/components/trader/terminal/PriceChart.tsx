"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LogicalRange,
  type UTCTimestamp,
} from "lightweight-charts";
import { useT } from "@/i18n/client";
import { TIMEFRAMES, channels, type Bar, type InstrumentInfo, type ServerMessage, type Timeframe } from "@/trading/protocol";
import type { TradingSocket } from "@/lib/hooks/useTradingSocket";
import { bucketStartSeconds } from "./tradingMath";

const PAGE_SIZE = 500;
const INITIAL_VISIBLE_BARS = 120;
/** Load older history once the user has scrolled within this many bars of the left edge. */
const LEFT_EDGE_THRESHOLD = 25;

function cssColor(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function toCandle(bar: Bar): CandlestickData<UTCTimestamp> {
  return { time: bar.time as UTCTimestamp, open: bar.open, high: bar.high, low: bar.low, close: bar.close };
}

/** Tick timestamps may arrive in ms (Date.now()) or seconds; normalise to seconds. */
function toSeconds(ts: number): number {
  return ts > 1e11 ? Math.floor(ts / 1000) : Math.floor(ts);
}

async function fetchBars(symbol: string, tf: Timeframe, before?: number): Promise<Bar[]> {
  const params = new URLSearchParams({ symbol, tf, limit: String(PAGE_SIZE) });
  if (before) params.set("before", String(before));
  const res = await fetch(`/api/market/bars?${params.toString()}`, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load price history (${res.status})`);
  return (await res.json()) as Bar[];
}

export function PriceChart({
  symbol,
  instrument,
  timeframe,
  onTimeframeChange,
  subscribe,
  unsubscribe,
  onMessage,
  socketStatus,
}: {
  symbol: string;
  instrument: InstrumentInfo | undefined;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  subscribe: TradingSocket["subscribe"];
  unsubscribe: TradingSocket["unsubscribe"];
  onMessage: TradingSocket["onMessage"];
  socketStatus: TradingSocket["status"];
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const pendingPriceRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const barsRef = useRef<Bar[]>([]);
  const hasMoreRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const loadIdRef = useRef(0);

  // Everything shown in the header is keyed by symbol+timeframe, so switching
  // instruments derives "loading" instead of resetting state inside an effect.
  const seriesKey = `${symbol}:${timeframe}`;
  const seriesKeyRef = useRef(seriesKey);
  const [history, setHistory] = useState<{ key: string; error: string | null; count: number } | null>(null);
  const [live, setLive] = useState<{ key: string; price: number | null; count: number } | null>(null);

  const loading = history?.key !== seriesKey;
  const loadError = history?.key === seriesKey ? history.error : null;
  const barCount = live?.key === seriesKey ? live.count : history?.key === seriesKey ? history.count : 0;
  const lastPrice = live?.key === seriesKey ? live.price : null;

  const digits = instrument?.digits ?? 5;

  // Create the chart once; theme colours come from the CSS tokens in globals.css.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const surface = cssColor("--surface", "#0d1017");
    const border = cssColor("--border", "#1e2330");
    const muted = cssColor("--muted", "#8b92a4");
    const success = cssColor("--success", "#22c55e");
    const danger = cssColor("--danger", "#ef4444");

    const chart = createChart(el, {
      width: el.clientWidth || 320,
      height: el.clientHeight || 260,
      layout: {
        background: { type: ColorType.Solid, color: surface },
        textColor: muted,
        fontSize: 11,
        attributionLogo: true,
      },
      grid: { vertLines: { color: border }, horzLines: { color: border } },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, timeVisible: true, secondsVisible: false, rightOffset: 3, barSpacing: 7, minBarSpacing: 2 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: "en-US" },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: success,
      downColor: danger,
      borderVisible: false,
      wickUpColor: success,
      wickDownColor: danger,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) chart.applyOptions({ width: Math.floor(width), height: Math.floor(height) });
      }
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLineRef.current = null;
    };
  }, []);

  // Price precision follows the instrument.
  useEffect(() => {
    seriesRef.current?.applyOptions({ priceFormat: { type: "price", precision: digits, minMove: Number(`1e-${digits}`) } });
  }, [digits]);

  const schedulePriceLine = useCallback((price: number) => {
    pendingPriceRef.current = price;
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const series = seriesRef.current;
      const value = pendingPriceRef.current;
      if (!series || value == null) return;
      if (!priceLineRef.current) {
        priceLineRef.current = series.createPriceLine({
          price: value,
          color: cssColor("--accent-2", "#3b82f6"),
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
          title: "",
        });
      } else {
        priceLineRef.current.applyOptions({ price: value });
      }
      const key = seriesKeyRef.current;
      setLive((prev) => ({ key, price: value, count: prev?.key === key ? prev.count : barsRef.current.length }));
    });
  }, []);

  const bumpLiveCount = useCallback(() => {
    const key = seriesKeyRef.current;
    setLive((prev) => ({ key, price: prev?.key === key ? prev.price : null, count: barsRef.current.length }));
  }, []);

  // Initial history for the symbol/timeframe.
  useEffect(() => {
    const loadId = ++loadIdRef.current;
    seriesKeyRef.current = seriesKey;
    barsRef.current = [];
    hasMoreRef.current = true;
    loadingOlderRef.current = false;
    const series = seriesRef.current;
    if (series) {
      series.setData([]);
      if (priceLineRef.current) {
        series.removePriceLine(priceLineRef.current);
        priceLineRef.current = null;
      }
    }

    fetchBars(symbol, timeframe)
      .then((bars) => {
        if (loadId !== loadIdRef.current) return;
        barsRef.current = bars;
        hasMoreRef.current = bars.length >= PAGE_SIZE;
        const s = seriesRef.current;
        const chart = chartRef.current;
        if (s && chart) {
          s.setData(bars.map(toCandle));
          if (bars.length > 0) {
            chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - INITIAL_VISIBLE_BARS), to: bars.length + 2 });
            schedulePriceLine(bars[bars.length - 1].close);
          }
        }
        setHistory({ key: seriesKey, error: null, count: bars.length });
      })
      .catch((err: unknown) => {
        if (loadId !== loadIdRef.current) return;
        setHistory({ key: seriesKey, error: err instanceof Error ? err.message : "Could not load price history", count: 0 });
      });
  }, [symbol, timeframe, seriesKey, schedulePriceLine]);

  // Older history when the user reaches the left edge.
  const loadOlder = useCallback(async () => {
    const oldest = barsRef.current[0];
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!oldest || !chart || !series || loadingOlderRef.current || !hasMoreRef.current) return;
    loadingOlderRef.current = true;
    const loadId = loadIdRef.current;
    try {
      const older = await fetchBars(symbol, timeframe, oldest.time);
      if (loadId !== loadIdRef.current) return;
      if (older.length < PAGE_SIZE) hasMoreRef.current = false;
      if (older.length === 0) return;
      const merged = [...older.filter((b) => b.time < oldest.time), ...barsRef.current];
      barsRef.current = merged;
      const visible = chart.timeScale().getVisibleRange();
      series.setData(merged.map(toCandle));
      if (visible) chart.timeScale().setVisibleRange(visible);
      bumpLiveCount();
    } catch {
      // Leave hasMore true so a later scroll can retry.
    } finally {
      if (loadId === loadIdRef.current) loadingOlderRef.current = false;
    }
  }, [symbol, timeframe, bumpLiveCount]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const handler = (range: LogicalRange | null) => {
      if (!range) return;
      if (range.from < LEFT_EDGE_THRESHOLD && barsRef.current.length > 0) void loadOlder();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler);
  }, [loadOlder]);

  // Live updates: server-built bars for this timeframe, plus ticks for the
  // forming candle and the last-price line (the tick channel is owned by the terminal).
  useEffect(() => {
    subscribe([channels.bars(symbol, timeframe)]);
    return () => unsubscribe([channels.bars(symbol, timeframe)]);
  }, [symbol, timeframe, subscribe, unsubscribe]);

  useEffect(() => {
    return onMessage((msg: ServerMessage) => {
      const series = seriesRef.current;
      if (!series) return;
      const bars = barsRef.current;

      if (msg.type === "bar" && msg.symbol === symbol && msg.tf === timeframe) {
        const incoming: Bar = { ...msg.bar, time: toSeconds(msg.bar.time) };
        const last = bars[bars.length - 1];
        if (last && incoming.time < last.time) return;
        if (last && incoming.time === last.time) bars[bars.length - 1] = incoming;
        else bars.push(incoming);
        series.update(toCandle(incoming));
        if (!last || incoming.time > last.time) bumpLiveCount();
        return;
      }

      if (msg.type === "tick" && msg.symbol === symbol) {
        const price = msg.bid;
        const bucket = bucketStartSeconds(toSeconds(msg.ts), timeframe);
        const last = bars[bars.length - 1];
        if (!last || bucket > last.time) {
          const fresh: Bar = { time: bucket, open: price, high: price, low: price, close: price, volume: 0 };
          bars.push(fresh);
          series.update(toCandle(fresh));
          bumpLiveCount();
        } else if (bucket === last.time) {
          last.close = price;
          if (price > last.high) last.high = price;
          if (price < last.low) last.low = price;
          series.update(toCandle(last));
        }
        schedulePriceLine(price);
      }
    });
  }, [onMessage, symbol, timeframe, schedulePriceLine, bumpLiveCount]);

  const empty = !loading && !loadError && barCount === 0;

  return (
    <div className="card flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-semibold">{symbol}</span>
          {instrument && <span className="hidden truncate text-xs text-muted sm:inline">{instrument.displayName}</span>}
          {lastPrice != null && <span className="font-mono text-xs tabular-nums text-accent-2">{lastPrice.toFixed(digits)}</span>}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label={t("trading.chart.timeframe")}>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              aria-pressed={tf === timeframe}
              onClick={() => onTimeframeChange(tf)}
              className={clsx(
                "rounded-md px-2 py-1 text-[11px] font-medium",
                tf === timeframe ? "bg-accent-2/15 text-accent-2" : "text-muted hover:bg-white/5 hover:text-foreground",
              )}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className="relative h-64 w-full sm:h-80 lg:h-[420px]">
        <div ref={containerRef} className="absolute inset-0" aria-label={t("trading.chart.aria", { symbol, timeframe })} role="img" />
        {loading && (
          <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
            <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{t("trading.chart.loading")}</span>
          </div>
        )}
        {loadError && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center">
            <span className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger" title={loadError}>
              {t("trading.chart.historyError")}
            </span>
          </div>
        )}
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center">
            <div className="max-w-xs rounded-lg border border-border bg-surface-2/90 px-3 py-2 text-xs text-muted">
              {t("trading.chart.empty", { symbol })} {socketStatus === "open" ? t("trading.chart.emptyLive") : t("trading.chart.emptyWaiting")}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-1 text-[10px] text-muted">
        <span>{barCount > 0 ? t("trading.chart.barsLoaded", { count: barCount }) : ""}</span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
          {t("trading.chart.attribution")}
        </a>
      </div>
    </div>
  );
}
