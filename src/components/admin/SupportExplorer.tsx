"use client";

import { useEffect, useState } from "react";
import { useServerTable } from "@/lib/hooks/useServerTable";
import { SearchInput, FilterTabs } from "@/components/ui/Toolbar";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { StatusBadge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { formatDateTime } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";

type Ticket = {
  id: string;
  subject: string;
  message: string;
  response: string | null;
  status: string;
  priority: string;
  createdAt: string;
  user: { id: string; name: string; email: string };
};

const STATUS_TABS = [
  { label: "All", value: "ALL" },
  { label: "Open", value: "OPEN" },
  { label: "Pending", value: "PENDING" },
  { label: "Resolved", value: "RESOLVED" },
  { label: "Closed", value: "CLOSED" },
];

export function SupportExplorer() {
  const [status, setStatus] = useState("OPEN");
  const [selected, setSelected] = useState<Ticket | null>(null);
  const { search, setSearch, setPage, data, loading, error, refetch } = useServerTable<Ticket>("/api/admin/support", { status });

  const columns: Column<Ticket>[] = [
    { key: "user", header: "Trader", render: (r) => <div><div className="font-medium">{r.user.name}</div><div className="text-xs text-muted">{r.user.email}</div></div> },
    { key: "subject", header: "Subject", render: (r) => <span className="font-medium">{r.subject}</span> },
    { key: "priority", header: "Priority", render: (r) => <span className="text-xs text-muted">{r.priority}</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "created", header: "Created", render: (r) => formatDateTime(r.createdAt) },
    { key: "actions", header: "", render: (r) => <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setSelected(r)}>Open</button> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={search} onChange={setSearch} placeholder="Search subject or email…" />
        <FilterTabs value={status} onChange={setStatus} options={STATUS_TABS} />
      </div>
      <div className="card !p-0 overflow-hidden">
        <DataTable columns={columns} rows={data.items} loading={loading} error={error} rowKey={(r) => r.id} emptyTitle="No tickets" emptyDescription="Nothing matches your filters." />
        <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
      </div>
      <TicketModal ticket={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); refetch(); }} />
    </div>
  );
}

function TicketModal({ ticket, onClose, onSaved }: { ticket: Ticket | null; onClose: () => void; onSaved: () => void }) {
  const [response, setResponse] = useState("");
  const [status, setStatus] = useState("PENDING");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResponse(ticket?.response ?? "");
    setStatus(ticket?.status === "OPEN" ? "PENDING" : (ticket?.status ?? "PENDING"));
  }, [ticket]);

  if (!ticket) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/support/${ticket!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: response || undefined, status }),
      });
      if (!res.ok) throw new Error();
      toast.push("Ticket updated", "success");
      onSaved();
    } catch {
      toast.push("Failed to update ticket", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!ticket} onClose={onClose} title={ticket.subject}>
      <form onSubmit={save} className="flex flex-col gap-3 text-sm">
        <div className="text-xs text-muted">
          {ticket.user.name} ({ticket.user.email}) · {formatDateTime(ticket.createdAt)}
        </div>
        <p className="rounded-lg bg-surface-2 p-3">{ticket.message}</p>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Reply</span>
          <textarea className="input-base" rows={4} value={response} onChange={(e) => setResponse(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Status</span>
          <select className="input-base" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="OPEN">Open</option>
            <option value="PENDING">Pending (waiting on trader)</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Saving..." : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}
