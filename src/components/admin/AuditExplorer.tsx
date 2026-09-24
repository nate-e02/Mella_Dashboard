"use client";

import { useState } from "react";
import { useServerTable } from "@/lib/hooks/useServerTable";
import { SearchInput, FilterSelect } from "@/components/ui/Toolbar";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { formatDateTime } from "@/lib/format";

type AuditRow = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string; role: string } | null;
};

const TARGET_OPTIONS = [
  { label: "All targets", value: "" },
  { label: "User", value: "User" },
  { label: "TradingAccount", value: "TradingAccount" },
  { label: "Purchase", value: "Purchase" },
  { label: "Payout", value: "Payout" },
  { label: "KycSubmission", value: "KycSubmission" },
  { label: "Template", value: "Template" },
  { label: "SystemSetting", value: "SystemSetting" },
  { label: "TradingEngine", value: "TradingEngine" },
];

export function AuditExplorer() {
  const [targetType, setTargetType] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const { search, setSearch, setPage, data, loading, error } = useServerTable<AuditRow>("/api/admin/audit", { targetType, pageSize: "25" });

  const columns: Column<AuditRow>[] = [
    { key: "when", header: "When", render: (r) => <span className="whitespace-nowrap text-xs">{formatDateTime(r.createdAt)}</span> },
    { key: "action", header: "Action", render: (r) => <span className="font-mono text-xs">{r.action}</span> },
    {
      key: "actor",
      header: "Actor",
      render: (r) =>
        r.actor ? (
          <div>
            <div className="text-xs font-medium">{r.actor.name}</div>
            <div className="text-[10px] text-muted">{r.actor.email}</div>
          </div>
        ) : (
          <span className="text-xs text-muted">system</span>
        ),
    },
    {
      key: "target",
      header: "Target",
      render: (r) => (
        <span className="font-mono text-[11px] text-muted">
          {r.targetType} {r.targetId ? r.targetId.slice(0, 12) : ""}
        </span>
      ),
    },
    { key: "ip", header: "IP", render: (r) => <span className="font-mono text-[11px] text-muted">{r.ip ?? "—"}</span> },
    {
      key: "details",
      header: "Details",
      render: (r) => (
        <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setExpanded(expanded === r.id ? null : r.id)} aria-expanded={expanded === r.id}>
          {expanded === r.id ? "Hide" : "Show"}
        </button>
      ),
    },
  ];

  const selected = data.items.find((r) => r.id === expanded);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="Target id or action…" />
        <FilterSelect value={targetType} onChange={setTargetType} options={TARGET_OPTIONS} />
      </div>
      <div className="card !p-0 overflow-hidden">
        <DataTable columns={columns} rows={data.items} loading={loading} error={error} rowKey={(r) => r.id} emptyTitle="No audit entries" emptyDescription="Nothing matches your filters." />
        <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
      </div>
      {selected && (
        <div className="card p-4 text-xs">
          <div className="mb-2 flex flex-wrap gap-4 text-muted">
            <span>request {selected.requestId ?? "—"}</span>
            <span className="truncate">{selected.userAgent ?? ""}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 font-semibold uppercase tracking-wide text-muted">Before</div>
              <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3">{JSON.stringify(selected.before, null, 2) ?? "null"}</pre>
            </div>
            <div>
              <div className="mb-1 font-semibold uppercase tracking-wide text-muted">After</div>
              <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3">{JSON.stringify(selected.after, null, 2) ?? "null"}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
