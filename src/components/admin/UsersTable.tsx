"use client";

import Link from "next/link";
import { useState } from "react";
import { useServerTable } from "@/lib/hooks/useServerTable";
import { SearchInput, FilterTabs, FilterSelect } from "@/components/ui/Toolbar";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { formatCurrency, formatDate, timeAgo } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";
import { CreateUserModal } from "@/components/admin/CreateUserModal";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  accountCount: number;
  activeAccounts: number;
  fundedAccounts: number;
  totalPurchases: number;
  totalRevenue: number;
  kycStatus: string;
  createdAt: string;
  lastActivityAt: string | null;
};

const STATUS_TABS = [
  { label: "All", value: "ALL" },
  { label: "Active", value: "ACTIVE" },
  { label: "Disabled", value: "DISABLED" },
];

const ROLE_OPTIONS = [
  { label: "All Roles", value: "ALL" },
  { label: "Admin", value: "ADMIN" },
  { label: "Trader", value: "TRADER" },
];

export function UsersTable() {
  const [status, setStatus] = useState("ALL");
  const [role, setRole] = useState("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const { search, setSearch, setPage, data, loading, error, refetch } = useServerTable<UserRow>("/api/admin/users", {
    status,
    role,
  });
  const toast = useToast();

  async function toggleStatus(row: UserRow) {
    const nextStatus = row.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error();
      toast.push(nextStatus === "DISABLED" ? "User disabled" : "User enabled", "success");
      refetch();
    } catch {
      toast.push("Failed to update user", "error");
    }
  }

  async function changeRole(row: UserRow, newRole: string) {
    try {
      const res = await fetch(`/api/admin/users/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error();
      toast.push("Role updated", "success");
      refetch();
    } catch {
      toast.push("Failed to update role", "error");
    }
  }

  const columns: Column<UserRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          <div className="text-xs text-muted">{r.email}</div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (r) => (
        <select className="input-base !w-auto !py-1 text-xs" value={r.role} onChange={(e) => changeRole(r, e.target.value)}>
          <option value="TRADER">Trader</option>
          <option value="ADMIN">Admin</option>
        </select>
      ),
    },
    { key: "accounts", header: "Accounts", render: (r) => `${r.accountCount} (${r.activeAccounts} active, ${r.fundedAccounts} funded)` },
    { key: "purchases", header: "Purchases", render: (r) => r.totalPurchases },
    { key: "revenue", header: "Revenue", render: (r) => formatCurrency(r.totalRevenue) },
    { key: "kyc", header: "KYC", render: (r) => (r.kycStatus === "NONE" ? <Badge tone="muted">None</Badge> : <StatusBadge status={r.kycStatus} />) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "created", header: "Created", render: (r) => formatDate(r.createdAt) },
    { key: "activity", header: "Last Activity", render: (r) => timeAgo(r.lastActivityAt) },
    {
      key: "actions",
      header: "Actions",
      render: (r) => (
        <div className="flex gap-1.5">
          <Link href={`/admin/users/${r.id}`} className="btn-ghost !px-2 !py-1 text-xs">
            View
          </Link>
          <button onClick={() => toggleStatus(r)} className={`btn-ghost !px-2 !py-1 text-xs ${r.status === "ACTIVE" ? "text-danger" : "text-success"}`}>
            {r.status === "ACTIVE" ? "Disable" : "Enable"}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by name or email..." />
          <FilterSelect value={role} onChange={setRole} options={ROLE_OPTIONS} />
          <FilterTabs value={status} onChange={setStatus} options={STATUS_TABS} />
        </div>
        <button className="btn-primary" onClick={() => setCreateOpen(true)}>
          + New User
        </button>
      </div>
      <div className="card !p-0 overflow-hidden">
        <DataTable columns={columns} rows={data.items} loading={loading} error={error} rowKey={(r) => r.id} emptyTitle="No users found" emptyDescription="No users match your search or filters." />
        <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
      </div>
      <CreateUserModal
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
