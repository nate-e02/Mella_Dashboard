"use client";

import Link from "next/link";
import { useState } from "react";
import { useServerTable } from "@/lib/hooks/useServerTable";
import { SearchInput } from "@/components/ui/Toolbar";
import { FilterTabs } from "@/components/ui/Toolbar";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { StatusBadge } from "@/components/ui/Badge";
import { formatCurrency, formatDate } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";
import { CreateAccountModal } from "@/components/admin/CreateAccountModal";

type AccountRow = {
  id: string;
  user: { id: string; name: string; email: string };
  template: { id: string; name: string } | null;
  phase: string;
  status: string;
  startingBalance: number;
  balance: number;
  equity: number;
  createdAt: string;
  updatedAt: string;
};

const STATUS_TABS = [
  { label: "All", value: "ALL" },
  { label: "Active", value: "ACTIVE" },
  { label: "Passed", value: "PASSED" },
  { label: "Failed", value: "FAILED" },
  { label: "Suspended", value: "SUSPENDED" },
  { label: "Frozen", value: "FROZEN" },
  { label: "Funded", value: "FUNDED" },
];

function allowedTargets(status: string, phase: string): string[] {
  const reinstate = phase === "FUNDED" ? "FUNDED" : "ACTIVE";
  switch (status) {
    case "ACTIVE":
    case "FUNDED":
      return ["SUSPENDED", "FROZEN", "FAILED"];
    case "SUSPENDED":
    case "FROZEN":
      return [reinstate, "FAILED"];
    case "FAILED":
      return [reinstate];
    default:
      return [];
  }
}

export function AccountsTable() {
  const [status, setStatus] = useState("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const { search, setSearch, setPage, data, loading, error, refetch } = useServerTable<AccountRow>(
    "/api/admin/accounts",
    { status },
  );
  const toast = useToast();

  async function changeStatus(id: string, newStatus: string) {
    try {
      const res = await fetch(`/api/admin/accounts/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to update status");
      toast.push("Account status updated", "success");
      refetch();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Failed to update status", "error");
    }
  }

  const columns: Column<AccountRow>[] = [
    { key: "id", header: "Account", render: (r) => <span className="font-mono text-xs text-muted">{r.id.slice(0, 10)}...</span> },
    {
      key: "trader",
      header: "Trader",
      render: (r) => (
        <div>
          <div className="font-medium">{r.user.name}</div>
          <div className="text-xs text-muted">{r.user.email}</div>
        </div>
      ),
    },
    { key: "template", header: "Template", render: (r) => r.template?.name ?? "—" },
    { key: "phase", header: "Phase", render: (r) => r.phase.replace("_", " ") },
    { key: "balance", header: "Balance", render: (r) => formatCurrency(r.balance, "ETB") },
    { key: "equity", header: "Equity", render: (r) => formatCurrency(r.equity, "ETB") },
    {
      key: "pnl",
      header: "P&L",
      render: (r) => {
        const pnl = r.balance - r.startingBalance;
        return <span className={pnl >= 0 ? "text-success" : "text-danger"}>{formatCurrency(pnl, "ETB")}</span>;
      },
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "created", header: "Created", render: (r) => formatDate(r.createdAt) },
    {
      key: "actions",
      header: "Actions",
      render: (r) => (
        <div className="flex items-center gap-2">
          <Link href={`/admin/accounts/${r.id}`} className="btn-ghost !px-2 !py-1 text-xs">
            View
          </Link>
          <select
            className="input-base !w-auto !py-1 text-xs"
            value=""
            aria-label="Set account status"
            onChange={(e) => e.target.value && changeStatus(r.id, e.target.value)}
            disabled={allowedTargets(r.status, r.phase).length === 0}
          >
            <option value="">Set status...</option>
            {allowedTargets(r.status, r.phase).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by trader, email, or template..." />
          <FilterTabs value={status} onChange={setStatus} options={STATUS_TABS} />
        </div>
        <button className="btn-primary" onClick={() => setCreateOpen(true)}>
          + New Account
        </button>
      </div>
      <div className="card !p-0 overflow-hidden">
        <DataTable
          columns={columns}
          rows={data.items}
          loading={loading}
          error={error}
          rowKey={(r) => r.id}
          emptyTitle="No accounts found"
          emptyDescription="No trading accounts match your search or filters."
        />
        <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
      </div>
      <CreateAccountModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          refetch();
        }}
      />
    </div>
  );
}
