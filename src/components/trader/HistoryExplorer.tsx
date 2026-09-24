"use client";

import { useEffect, useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { StatusBadge, useStatusLabel } from "@/components/ui/Badge";
import { formatDateTime, formatSigned } from "@/lib/format";
import { useT } from "@/i18n/client";

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

const TIMEFRAMES = ["this_month", "last_month", "3_months", "6_months", "this_year", "all_time", "custom"] as const;

export function HistoryExplorer() {
  const t = useT();
  const statusLabel = useStatusLabel();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [accountId, setAccountId] = useState("");
  const [timeframe, setTimeframe] = useState("this_month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: Trade[]; total: number; page: number; totalPages: number }>({ items: [], total: 0, page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

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
    setLoadFailed(false);
    const params = new URLSearchParams({ timeframe, page: String(page) });
    if (timeframe === "custom") {
      if (from) params.set("from", from);
      if (to) params.set("to", to);
    }
    fetch(`/api/trader/accounts/${accountId}/trades?${params.toString()}`)
      .then((r) => {
        if (!r.ok) throw new Error("load_failed");
        return r.json();
      })
      .then(setData)
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, [accountId, timeframe, from, to, page]);

  // Reset to page 1 whenever the account/timeframe/date range changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
     
  }, [accountId, timeframe, from, to]);

  const sideLabel = (side: string) => (side === "BUY" ? t("common.side.BUY") : side === "SELL" ? t("common.side.SELL") : side);
  const columns: Column<Trade>[] = [
    { key: "symbol", header: t("app.history.col.symbol"), render: (tr) => <span className="font-medium">{tr.symbol}</span> },
    { key: "side", header: t("app.history.col.side"), render: (tr) => sideLabel(tr.side) },
    { key: "entry", header: t("app.history.col.entry"), render: (tr) => tr.entryPrice },
    { key: "exit", header: t("app.history.col.exit"), render: (tr) => tr.exitPrice ?? "—" },
    { key: "volume", header: t("app.history.col.volume"), render: (tr) => tr.volume },
    {
      key: "pnl",
      header: t("app.history.col.pnl"),
      render: (tr) => <span className={tr.netProfit >= 0 ? "text-success" : "text-danger"}>{formatSigned(tr.netProfit, "ETB")}</span>,
    },
    { key: "status", header: t("app.history.col.status"), render: (tr) => <StatusBadge status={tr.status} /> },
    { key: "opened", header: t("app.history.col.date"), render: (tr) => formatDateTime(tr.openTime) },
  ];

  if (!loading && accounts.length === 0) {
    return (
      <div className="card p-10 text-center">
        <div className="text-sm font-medium">{t("app.history.noAccounts")}</div>
        <div className="mt-1 text-xs text-muted">{t("app.history.noAccountsHint")}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <select aria-label={t("app.history.account")} className="input-base sm:max-w-xs" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.template?.name ?? a.id} — {statusLabel(a.status)}
            </option>
          ))}
        </select>
        <select aria-label={t("app.history.timeframe")} className="input-base sm:max-w-[180px]" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
          {TIMEFRAMES.map((tf) => (
            <option key={tf} value={tf}>
              {t(`app.history.tf.${tf}`)}
            </option>
          ))}
        </select>
        {timeframe === "custom" && (
          <>
            <input type="date" aria-label={t("app.history.from")} className="input-base sm:max-w-[160px]" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input type="date" aria-label={t("app.history.to")} className="input-base sm:max-w-[160px]" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
      </div>

      <div className="card !p-0 overflow-hidden">
        <DataTable
          columns={columns}
          rows={data.items}
          loading={loading}
          error={loadFailed ? t("app.history.loadFailed") : null}
          rowKey={(tr) => tr.id}
          emptyTitle={t("app.history.emptyTitle")}
          emptyDescription={t("app.history.emptyDescription")}
        />
        <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
      </div>
    </div>
  );
}
