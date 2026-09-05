"use client";

import { useEffect, useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { StatusBadge } from "@/components/ui/Badge";
import { formatCurrency, formatDateTime } from "@/lib/format";

type AccountOption = { id: string; template: { id: string; name: string } | null; status: string };
type Trade = {
  id: string;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number | null;
  volume: number;
  netProfit: number;
  status: string;
  openTime: string;
  closeTime: string | null;
};

const TIMEFRAMES = [
  { label: "This Month", value: "this_month" },
  { label: "Last Month", value: "last_month" },
  { label: "3 Months", value: "3_months" },
  { label: "6 Months", value: "6_months" },
  { label: "This Year", value: "this_year" },
  { label: "All Time", value: "all_time" },
  { label: "Custom Range", value: "custom" },
];

export function HistoryExplorer() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [timeframe, setTimeframe] = useState("this_month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Trade[]; total: number; page: number; totalPages: number }>({ items: [], total: 0, page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/trader/accounts")
      .then((r) => r.json())
      .then((list: AccountOption[]) => {
        setAccounts(list);
        if (list.length > 0) setAccountId(list[0].id);
        else setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!accountId) return;
    // Fetching trade history from an external API in response to changing
    // filters is exactly what effects are for; loading/error state here
    // synchronizes with that external system.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ timeframe, page: String(page) });
    if (timeframe === "custom") {
      if (from) params.set("from", from);
      if (to) params.set("to", to);
    }
    fetch(`/api/trader/accounts/${accountId}/trades?${params.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load trade history");
        return r.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [accountId, timeframe, from, to, page]);

  // Reset to page 1 whenever the account/timeframe/date range changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
     
  }, [accountId, timeframe, from, to]);

  const columns: Column<Trade>[] = [
    { key: "symbol", header: "Symbol", render: (t) => <span className="font-medium">{t.symbol}</span> },
    { key: "side", header: "Direction", render: (t) => t.side },
    { key: "entry", header: "Entry", render: (t) => t.entryPrice },
    { key: "exit", header: "Exit", render: (t) => t.exitPrice ?? "—" },
    { key: "volume", header: "Volume", render: (t) => t.volume },
    { key: "pnl", header: "Profit/Loss", render: (t) => <span className={t.netProfit >= 0 ? "text-success" : "text-danger"}>{formatCurrency(t.netProfit)}</span> },
    { key: "status", header: "Status", render: (t) => <StatusBadge status={t.status} /> },
    { key: "opened", header: "Date", render: (t) => formatDateTime(t.openTime) },
  ];

  if (!loading && accounts.length === 0) {
    return (
      <div className="card p-10 text-center">
        <div className="text-sm font-medium">No accounts yet.</div>
        <div className="mt-1 text-xs text-muted">Purchase a challenge to start building trade history.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <select className="input-base sm:max-w-xs" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.template?.name ?? a.id} — {a.status}
            </option>
          ))}
        </select>
        <select className="input-base sm:max-w-[180px]" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
          {TIMEFRAMES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        {timeframe === "custom" && (
          <>
            <input type="date" className="input-base sm:max-w-[160px]" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" className="input-base sm:max-w-[160px]" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
      </div>

      <div className="card !p-0 overflow-hidden">
        <DataTable columns={columns} rows={data.items} loading={loading} error={error} rowKey={(t) => t.id} emptyTitle="No trades for this account" emptyDescription="No trades were recorded in the selected timeframe." />
        <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
      </div>
    </div>
  );
}
