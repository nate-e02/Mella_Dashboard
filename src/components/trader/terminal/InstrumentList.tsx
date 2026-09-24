"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { useT } from "@/i18n/client";
import type { InstrumentInfo, Tick } from "@/trading/protocol";
import type { MarketStatus } from "@/lib/hooks/useTradingSocket";
import { CATEGORY_LABEL, formatPrice, spreadPoints } from "./tradingMath";

type Category = InstrumentInfo["category"] | "ALL";
type Direction = "up" | "down" | null;

/** Price text that flashes and shows a ▲/▼ glyph when the quote moves (no colour-only signalling). */
const PriceCell = memo(function PriceCell({ value, digits, align = "right" }: { value: number | null; digits: number; align?: "left" | "right" }) {
  const prev = useRef<number | null>(null);
  const [dir, setDir] = useState<Direction>(null);

  useEffect(() => {
    if (value == null || prev.current == null || value === prev.current) {
      prev.current = value;
      return;
    }
    const next: Direction = value > prev.current ? "up" : "down";
    prev.current = value;
    setDir(next);
    const timer = setTimeout(() => setDir(null), 450);
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-0.5 rounded px-1 font-mono text-xs tabular-nums transition-colors duration-300",
        align === "right" ? "justify-end" : "justify-start",
        dir === "up" && "bg-success/20 text-success",
        dir === "down" && "bg-danger/20 text-danger",
        dir === null && "text-foreground",
      )}
    >
      {formatPrice(value, digits)}
      <span className="w-2 text-[9px]" aria-hidden="true">
        {dir === "up" ? "▲" : dir === "down" ? "▼" : ""}
      </span>
    </span>
  );
});

const Row = memo(function Row({
  instrument,
  tick,
  selected,
  stale,
  onSelect,
}: {
  instrument: InstrumentInfo;
  tick: Tick | undefined;
  selected: boolean;
  stale: boolean;
  onSelect: (symbol: string) => void;
}) {
  const t = useT();
  const bid = tick?.bid ?? null;
  const ask = tick?.ask ?? null;
  const spread = bid != null && ask != null ? spreadPoints(bid, ask, instrument.digits) : null;
  return (
    <button
      type="button"
      onClick={() => onSelect(instrument.symbol)}
      aria-pressed={selected}
      aria-label={bid != null ? t("trading.instruments.rowAria", { name: instrument.displayName, bid: formatPrice(bid, instrument.digits), ask: formatPrice(ask, instrument.digits) }) : instrument.displayName}
      className={clsx(
        "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition",
        selected ? "bg-accent-2/15" : "hover:bg-white/5",
      )}
    >
      <div className="min-w-0">
        <div className={clsx("truncate text-xs font-semibold", selected ? "text-accent-2" : "text-foreground")}>{instrument.symbol}</div>
        <div className="truncate text-[10px] text-muted">
          {spread != null ? t("trading.instruments.points", { points: spread }) : instrument.displayName}
          {stale && <span className="ml-1 text-warning">{t("trading.instruments.stale")}</span>}
        </div>
      </div>
      <div className="flex flex-col items-end">
        <PriceCell value={bid} digits={instrument.digits} />
        <PriceCell value={ask} digits={instrument.digits} />
      </div>
    </button>
  );
});

export function InstrumentList({
  instruments,
  selected,
  onSelect,
  lastTick,
  marketState,
}: {
  instruments: InstrumentInfo[];
  selected: string;
  onSelect: (symbol: string) => void;
  lastTick: Map<string, Tick>;
  marketState: MarketStatus | null;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category>("ALL");

  const categories = useMemo(() => {
    const present = new Set(instruments.map((i) => i.category));
    return (["FOREX", "METAL", "CRYPTO", "INDEX"] as InstrumentInfo["category"][]).filter((c) => present.has(c));
  }, [instruments]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return instruments.filter((i) => (category === "ALL" || i.category === category) && (q === "" || i.symbol.includes(q) || i.displayName.toUpperCase().includes(q)));
  }, [instruments, search, category]);

  const selectedInstrument = instruments.find((i) => i.symbol === selected);
  const selectedTick = lastTick.get(selected);

  const isStale = (symbol: string) => Boolean(marketState?.symbols?.[symbol]?.stale);

  return (
    <>
      {/* Mobile: chip strip + dropdown */}
      <div className="card flex flex-col gap-2 p-2 lg:hidden">
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="instrument-select">
            {t("trading.instruments.instrument")}
          </label>
          <select id="instrument-select" className="input-base !w-auto flex-1 !py-1.5" value={selected} onChange={(e) => onSelect(e.target.value)}>
            {instruments.map((i) => (
              <option key={i.symbol} value={i.symbol}>
                {i.symbol} · {i.displayName}
              </option>
            ))}
          </select>
          {selectedInstrument && (
            <div className="flex flex-col items-end text-[10px] text-muted">
              <PriceCell value={selectedTick?.bid ?? null} digits={selectedInstrument.digits} />
              <PriceCell value={selectedTick?.ask ?? null} digits={selectedInstrument.digits} />
            </div>
          )}
        </div>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t("trading.instruments.quick")}>
          {instruments.slice(0, 12).map((i) => {
            const active = i.symbol === selected;
            return (
              <button
                key={i.symbol}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelect(i.symbol)}
                className={clsx(
                  "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                  active ? "border-accent-2/40 bg-accent-2/15 text-accent-2" : "border-border bg-surface-2 text-muted",
                )}
              >
                {i.symbol}
              </button>
            );
          })}
        </div>
      </div>

      {/* Desktop: searchable list */}
      <div className="card hidden max-h-[calc(100vh-9rem)] flex-col lg:flex">
        <div className="flex flex-col gap-2 border-b border-border p-2">
          <input
            type="search"
            className="input-base !py-1.5 text-xs"
            placeholder={t("trading.instruments.search")}
            aria-label={t("trading.instruments.searchAria")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("trading.instruments.categories")}>
            {(["ALL", ...categories] as Category[]).map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={category === c}
                onClick={() => setCategory(c)}
                className={clsx(
                  "rounded-md px-2 py-0.5 text-[11px] font-medium",
                  category === c ? "bg-accent-2/15 text-accent-2" : "text-muted hover:bg-white/5 hover:text-foreground",
                )}
              >
                {c === "ALL" ? t("trading.category.ALL") : t(CATEGORY_LABEL[c])}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="p-3 text-center text-xs text-muted">{t("trading.instruments.noMatch")}</div>
          ) : (
            filtered.map((i) => (
              <Row key={i.symbol} instrument={i} tick={lastTick.get(i.symbol)} selected={i.symbol === selected} stale={isStale(i.symbol)} onSelect={onSelect} />
            ))
          )}
        </div>
      </div>
    </>
  );
}
