"use client";

import { useEffect, useState } from "react";
import { useServerTable } from "@/lib/hooks/useServerTable";
import { SearchInput, FilterTabs } from "@/components/ui/Toolbar";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { StatusBadge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";

type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  source: string;
  value: number;
  notes: string;
  createdAt: string;
};

type PurchaseRow = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  providerTxRef: string;
  createdAt: string;
  user: { name: string; email: string };
  template: { name: string } | null;
};

const LEAD_TABS = [
  { label: "All", value: "ALL" },
  { label: "New", value: "NEW" },
  { label: "Qualified", value: "QUALIFIED" },
  { label: "Negotiation", value: "NEGOTIATION" },
  { label: "Converted", value: "CONVERTED" },
  { label: "Lost", value: "LOST" },
];

const PURCHASE_TABS = [
  { label: "All", value: "ALL" },
  { label: "Pending", value: "PENDING" },
  { label: "Paid", value: "PAID" },
  { label: "Failed", value: "FAILED" },
  { label: "Refunded", value: "REFUNDED" },
  { label: "Cancelled", value: "CANCELLED" },
];

export function CrmExplorer() {
  const [tab, setTab] = useState<"leads" | "purchased">("leads");
  const [stats, setStats] = useState({ totalLeads: 0, qualified: 0, converted: 0, revenue: 0, openTickets: 0, products: 0 });

  useEffect(() => {
    fetch("/api/admin/crm/stats").then((r) => r.json()).then(setStats).catch(() => undefined);
  }, [tab]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total Leads" value={stats.totalLeads} />
        <StatCard label="Qualified" value={stats.qualified} />
        <StatCard label="Converted" value={stats.converted} tone="success" />
        <StatCard label="Revenue" value={formatCurrency(stats.revenue)} />
        <StatCard label="Open Tickets" value={stats.openTickets} />
        <StatCard label="Products" value={stats.products} />
      </div>

      <div className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1 w-fit">
        <button onClick={() => setTab("leads")} className={`rounded-md px-4 py-1.5 text-sm font-medium ${tab === "leads" ? "bg-accent-2/20 text-accent-2" : "text-muted"}`}>
          Leads
        </button>
        <button onClick={() => setTab("purchased")} className={`rounded-md px-4 py-1.5 text-sm font-medium ${tab === "purchased" ? "bg-accent-2/20 text-accent-2" : "text-muted"}`}>
          Purchased
        </button>
      </div>

      {tab === "leads" ? <LeadsPanel /> : <PurchasedPanel />}
    </div>
  );
}

function LeadsPanel() {
  const [status, setStatus] = useState("ALL");
  const { search, setSearch, setPage, data, loading, error, refetch } = useServerTable<Lead>("/api/admin/crm/leads", { status });
  const [selected, setSelected] = useState<Lead | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const columns: Column<Lead>[] = [
    { key: "name", header: "Name", render: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{r.email}</div></div> },
    { key: "source", header: "Source", render: (r) => r.source },
    { key: "value", header: "Value", render: (r) => formatCurrency(r.value) },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "created", header: "Created", render: (r) => formatDateTime(r.createdAt) },
    { key: "actions", header: "Actions", render: (r) => <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setSelected(r)}>Edit</button> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput value={search} onChange={setSearch} placeholder="Search leads..." />
          <FilterTabs value={status} onChange={setStatus} options={LEAD_TABS} />
        </div>
        <button className="btn-primary" onClick={() => setCreateOpen(true)}>
          + New Lead
        </button>
      </div>
      <div className="card !p-0 overflow-hidden">
        <DataTable columns={columns} rows={data.items} loading={loading} error={error} rowKey={(r) => r.id} emptyTitle="No leads found" emptyDescription="No leads match your search or filters." />
        <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
      </div>
      <LeadModal lead={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); refetch(); }} />
      <LeadModal
        lead={createOpen ? ({ id: "", name: "", email: "", phone: "", status: "NEW", source: "Website", value: 0, notes: "", createdAt: "" } as Lead) : null}
        isCreate
        onClose={() => setCreateOpen(false)}
        onSaved={() => { setCreateOpen(false); refetch(); }}
      />
    </div>
  );
}

function LeadModal({ lead, onClose, onSaved, isCreate }: { lead: Lead | null; onClose: () => void; onSaved: () => void; isCreate?: boolean }) {
  const [form, setForm] = useState<Lead | null>(lead);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  // Sync the draft whenever a different lead is opened.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setForm(lead), [lead]);

  if (!form) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const payload = { name: form.name, email: form.email, phone: form.phone || undefined, status: form.status, source: form.source, value: Number(form.value), notes: form.notes };
      const res = await fetch(isCreate ? "/api/admin/crm/leads" : `/api/admin/crm/leads/${form.id}`, {
        method: isCreate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      toast.push(isCreate ? "Lead created" : "Lead updated", "success");
      onSaved();
    } catch {
      toast.push("Failed to save lead", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={!!lead} onClose={onClose} title={isCreate ? "New Lead" : "Edit Lead"}>
      <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1"><span className="font-medium">Name</span><input className="input-base" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label className="flex flex-col gap-1"><span className="font-medium">Email</span><input type="email" className="input-base" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
        <label className="flex flex-col gap-1"><span className="font-medium">Source</span><input className="input-base" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></label>
        <label className="flex flex-col gap-1"><span className="font-medium">Value</span><input type="number" min={0} className="input-base" value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} /></label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Status</span>
          <select className="input-base" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="NEW">New</option>
            <option value="QUALIFIED">Qualified</option>
            <option value="NEGOTIATION">Negotiation</option>
            <option value="CONVERTED">Converted</option>
            <option value="LOST">Lost</option>
          </select>
        </label>
        <label className="flex flex-col gap-1"><span className="font-medium">Notes</span><textarea className="input-base" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}

function PurchasedPanel() {
  const [status, setStatus] = useState("ALL");
  const { search, setSearch, setPage, data, loading, error, refetch } = useServerTable<PurchaseRow>("/api/admin/crm/purchased", { status });
  const toast = useToast();

  async function refund(id: string) {
    try {
      const res = await fetch(`/api/admin/crm/purchased/${id}/refund`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.push("Purchase refunded", "success");
      refetch();
    } catch {
      toast.push("Failed to refund purchase", "error");
    }
  }

  async function cancel(id: string) {
    try {
      const res = await fetch(`/api/admin/crm/purchased/${id}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.push("Purchase cancelled", "success");
      refetch();
    } catch {
      toast.push("Failed to cancel purchase", "error");
    }
  }

  async function markPaidTest(id: string) {
    try {
      const res = await fetch(`/api/admin/purchases/${id}/mark-paid`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.push("Purchase marked paid (test)", "success");
      refetch();
    } catch {
      toast.push("Failed to mark purchase paid", "error");
    }
  }

  const columns: Column<PurchaseRow>[] = [
    { key: "user", header: "User", render: (r) => <div><div className="font-medium">{r.user.name}</div><div className="text-xs text-muted">{r.user.email}</div></div> },
    { key: "template", header: "Product", render: (r) => r.template?.name ?? "—" },
    { key: "amount", header: "Amount", render: (r) => formatCurrency(r.amount, r.currency) },
    { key: "txn", header: "Transaction ID", render: (r) => <span className="font-mono text-xs text-muted">{r.providerTxRef}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "created", header: "Date", render: (r) => formatDateTime(r.createdAt) },
    {
      key: "actions",
      header: "Actions",
      render: (r) => {
        if (r.status === "PAID") {
          return (
            <div className="flex gap-1.5">
              <button className="btn-ghost !px-2 !py-1 text-xs text-warning" onClick={() => refund(r.id)}>Refund</button>
              <button className="btn-ghost !px-2 !py-1 text-xs text-danger" onClick={() => cancel(r.id)}>Cancel</button>
            </div>
          );
        }
        if (r.status === "PENDING" || r.status === "FAILED") {
          return (
            <button
              className="btn-ghost !px-2 !py-1 text-xs text-success"
              title="DEV/TEST ONLY: activates this purchase without a real Chapa payment"
              onClick={() => markPaidTest(r.id)}
            >
              Mark Paid (Test)
            </button>
          );
        }
        return <span className="text-xs text-muted">—</span>;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by user or transaction ID..." />
        <FilterTabs value={status} onChange={setStatus} options={PURCHASE_TABS} />
      </div>
      <div className="card !p-0 overflow-hidden">
        <DataTable columns={columns} rows={data.items} loading={loading} error={error} rowKey={(r) => r.id} emptyTitle="No purchases found" emptyDescription="No purchases match your search or filters." />
        <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
      </div>
    </div>
  );
}
