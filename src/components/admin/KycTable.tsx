"use client";

import { useEffect, useState } from "react";
import { useServerTable } from "@/lib/hooks/useServerTable";
import { SearchInput, FilterTabs } from "@/components/ui/Toolbar";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { StatusBadge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { formatDateTime } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";

type KycRow = {
  id: string;
  fullName: string;
  status: string;
  submittedAt: string;
  reviewedAt: string | null;
  notes: string;
  documentType: string;
  country: string;
  user: { id: string; name: string; email: string };
  reviewer: { id: string; name: string } | null;
};

const STATUS_TABS = [
  { label: "All", value: "ALL" },
  { label: "Pending", value: "PENDING" },
  { label: "Approved", value: "APPROVED" },
  { label: "Rejected", value: "REJECTED" },
];

export function KycTable() {
  const [status, setStatus] = useState("ALL");
  const { search, setSearch, setPage, data, loading, error, refetch } = useServerTable<KycRow>("/api/admin/kyc", { status });
  const [selected, setSelected] = useState<KycRow | null>(null);
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });

  useEffect(() => {
    fetch("/api/admin/kyc/stats").then((r) => r.json()).then(setStats).catch(() => undefined);
  }, [data]);

  const columns: Column<KycRow>[] = [
    {
      key: "user",
      header: "User",
      render: (r) => (
        <div>
          <div className="font-medium">{r.user.name}</div>
          <div className="text-xs text-muted">{r.user.email}</div>
        </div>
      ),
    },
    { key: "id", header: "Submission ID", render: (r) => <span className="font-mono text-xs text-muted">{r.id.slice(0, 10)}...</span> },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    { key: "submitted", header: "Submitted", render: (r) => formatDateTime(r.submittedAt) },
    { key: "reviewed", header: "Reviewed", render: (r) => formatDateTime(r.reviewedAt) },
    { key: "reviewer", header: "Reviewer", render: (r) => r.reviewer?.name ?? "—" },
    {
      key: "actions",
      header: "Actions",
      render: (r) => (
        <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setSelected(r)}>
          Review
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Submissions" value={stats.total} />
        <StatCard label="Pending Review" value={stats.pending} tone="warning" />
        <StatCard label="Approved" value={stats.approved} tone="success" />
        <StatCard label="Rejected" value={stats.rejected} tone="danger" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by name, email, or submission ID..." />
        <FilterTabs value={status} onChange={setStatus} options={STATUS_TABS} />
      </div>

      <div className="card !p-0 overflow-hidden">
        <DataTable columns={columns} rows={data.items} loading={loading} error={error} rowKey={(r) => r.id} emptyTitle="No KYC submissions" emptyDescription="No submissions match your search or filters." />
        <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
      </div>

      <KycReviewModal
        submission={selected}
        onClose={() => setSelected(null)}
        onDecided={() => {
          setSelected(null);
          refetch();
        }}
      />
    </div>
  );
}

function KycReviewModal({ submission, onClose, onDecided }: { submission: KycRow | null; onClose: () => void; onDecided: () => void }) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // Reset the notes draft whenever a different submission is opened.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotes(submission?.notes ?? "");
  }, [submission]);

  async function decide(decision: "APPROVED" | "REJECTED") {
    if (!submission) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/kyc/${submission.id}/decision`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: decision, notes }),
      });
      if (!res.ok) throw new Error();
      toast.push(`Submission ${decision.toLowerCase()}`, "success");
      onDecided();
    } catch {
      toast.push("Failed to update submission", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!submission) return null;

  return (
    <Modal open={!!submission} onClose={onClose} title="KYC Submission">
      <div className="flex flex-col gap-3 text-sm">
        <Row label="User" value={`${submission.user.name} (${submission.user.email})`} />
        <Row label="Full Name" value={submission.fullName} />
        <Row label="Country" value={submission.country} />
        <Row label="Document Type" value={submission.documentType} />
        <Row label="Status" value={submission.status} />
        <Row label="Submitted" value={formatDateTime(submission.submittedAt)} />
        <label className="flex flex-col gap-1">
          <span className="font-medium">Internal Notes</span>
          <textarea className="input-base" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <button className="btn-danger" disabled={busy} onClick={() => decide("REJECTED")}>
            Reject
          </button>
          <button className="btn-primary" disabled={busy} onClick={() => decide("APPROVED")}>
            Approve
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
