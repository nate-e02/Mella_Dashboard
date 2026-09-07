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
  fullName: string | null;
  status: string;
  submittedAt: string;
  reviewedAt: string | null;
  notes: string;
  documentType: string | null;
  country: string | null;
  provider: string;
  providerReference: string | null;
  failureReason: string | null;
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
    { key: "provider", header: "Provider", render: (r) => <span className="text-xs text-muted">{r.provider}</span> },
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
        <Row label="Provider" value={submission.provider} />
        <Row label="Provider Reference" value={submission.providerReference ?? "—"} />
        <Row label="Full Name" value={submission.fullName ?? "—"} />
        <Row label="Country" value={submission.country ?? "—"} />
        <Row label="Document Type" value={submission.documentType ?? "—"} />
        <Row label="Status" value={submission.status} />
        {submission.failureReason && <Row label="Failure Reason" value={submission.failureReason} />}
        <Row label="Submitted" value={formatDateTime(submission.submittedAt)} />
        <label className="flex flex-col gap-1">
          <span className="font-medium">Internal Notes</span>
          <textarea className="input-base" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {submission.status === "PENDING" && (
          <div className="flex justify-end gap-2">
            <button className="btn-danger" disabled={busy} onClick={() => decide("REJECTED")}>
              Reject
            </button>
            <button className="btn-primary" disabled={busy} onClick={() => decide("APPROVED")}>
              Approve
            </button>
          </div>
        )}

        <DevOverridePanel submission={submission} onOverridden={onDecided} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// TEMPORARY DEVELOPMENT KYC OVERRIDE — REMOVE BEFORE PRODUCTION
// Lets an admin force this submission's status without a real Dojah
// verification, for local development/testing only. Calls the temporary
// route at /api/admin/kyc/[id]/override, which is isolated from the real
// Dojah webhook/verification flow. Delete this component and that route
// together to remove the feature; nothing else needs to change.
// ---------------------------------------------------------------------------
function DevOverridePanel({ submission, onOverridden }: { submission: KycRow; onOverridden: () => void }) {
  const [status, setStatus] = useState<"PENDING" | "APPROVED" | "REJECTED">("APPROVED");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function apply() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/kyc/${submission.id}/override`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, reason: reason || undefined }),
      });
      if (!res.ok) throw new Error();
      toast.push(`Status manually set to ${status} (dev override)`, "success");
      onOverridden();
    } catch {
      toast.push("Failed to apply override", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-warning">Developer Override — Not a Real Verification</div>
      <p className="mb-2 text-xs text-muted">
        Temporary, admin-only, for local testing. Forces this record&apos;s status directly instead of a real Dojah verification. Every use is audit-logged as a manual override.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Status</span>
          <select className="input-base !w-auto !py-1.5 text-xs" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="PENDING">PENDING</option>
            <option value="APPROVED">APPROVED (VERIFIED)</option>
            <option value="REJECTED">REJECTED (FAILED)</option>
          </select>
        </label>
        <label className="flex flex-1 min-w-[160px] flex-col gap-1">
          <span className="text-xs text-muted">Reason (optional)</span>
          <input className="input-base !py-1.5 text-xs" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For audit log / testing notes" />
        </label>
        <button className="btn-secondary !py-1.5 text-xs" disabled={busy} onClick={apply}>
          {busy ? "Applying..." : "Apply Override (Dev Only)"}
        </button>
      </div>
    </div>
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
