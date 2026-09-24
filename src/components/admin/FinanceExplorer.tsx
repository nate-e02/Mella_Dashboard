"use client";

import { useCallback, useEffect, useState } from "react";
import { StatCard } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { RevenueAreaChart } from "@/components/ui/Charts";
import { Pagination } from "@/components/ui/Pagination";
import { FilterTabs } from "@/components/ui/Toolbar";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";

type Stats = {
  currency: string;
  revenueToday: number;
  revenueMonth: number;
  revenueTotal: number;
  payoutsThisMonthSum: number;
  payoutsThisMonthCount: number;
  avgPayoutSize: number;
  refundRate: number;
};
type Payout = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  requestedAt: string;
  paidAt: string | null;
  createdById: string | null;
  approvedById: string | null;
  paidById: string | null;
  rejectReason: string | null;
  providerRef: string | null;
  destination: { type?: string; accountNumber?: string; accountName?: string } | null;
  user: { name: string; email: string };
  tradingAccount: { id: string; template: { name: string } | null };
};
type FundedAccount = { id: string; balance: number; startingBalance: number; available: number; eligible: boolean; kycApproved: boolean; user: { name: string; email: string } };
type Paged<T> = { items: T[]; total: number; page: number; totalPages: number };

const PAYOUT_TABS = [
  { label: "All", value: "ALL" },
  { label: "Pending", value: "PENDING" },
  { label: "Approved", value: "APPROVED" },
  { label: "Paid", value: "PAID" },
  { label: "Rejected", value: "REJECTED" },
];

export function FinanceExplorer({ adminId }: { adminId: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [revenueSeries, setRevenueSeries] = useState<{ date: string; revenue: number }[]>([]);
  const [payouts, setPayouts] = useState<Paged<Payout>>({ items: [], total: 0, page: 1, totalPages: 1 });
  const [status, setStatus] = useState("PENDING");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [decision, setDecision] = useState<{ payout: Payout; status: "APPROVED" | "PAID" | "REJECTED" } | null>(null);

  const loadPayouts = useCallback(async () => {
    const res = await fetch(`/api/admin/payouts?status=${status}&page=${page}&pageSize=20`);
    if (res.ok) setPayouts(await res.json());
  }, [status, page]);

  useEffect(() => {
    fetch("/api/admin/overview-stats").then((r) => r.json()).then(setStats).catch(() => undefined);
    fetch("/api/admin/revenue-series").then((r) => r.json()).then(setRevenueSeries).catch(() => undefined);
  }, []);

  useEffect(() => {
    // Loading server data whenever the filter/page changes is what effects are for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPayouts();
  }, [loadPayouts]);

  const c = stats?.currency ?? "ETB";

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Revenue Today" value={formatCurrency(stats?.revenueToday ?? 0, c)} />
        <StatCard label="Revenue This Month" value={formatCurrency(stats?.revenueMonth ?? 0, c)} />
        <StatCard label="Payouts This Month" value={formatCurrency(stats?.payoutsThisMonthSum ?? 0, c)} sublabel={`${stats?.payoutsThisMonthCount ?? 0} paid`} />
        <StatCard label="Refund Rate (30d)" value={`${(stats?.refundRate ?? 0).toFixed(1)}%`} />
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold">Revenue (last 30 days)</h3>
        <RevenueAreaChart data={revenueSeries} currency={c} />
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold">Payouts</h3>
            <FilterTabs value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={PAYOUT_TABS} />
          </div>
          <button className="btn-primary !py-1.5 text-xs" onClick={() => setCreateOpen(true)}>
            + Record payout request
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">Trader</th>
                <th className="px-4 py-2.5">Account</th>
                <th className="px-4 py-2.5">Amount</th>
                <th className="px-4 py-2.5">Destination</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Requested</th>
                <th className="px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {payouts.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted">
                    No payouts in this view.
                  </td>
                </tr>
              )}
              {payouts.items.map((p) => {
                const canApprove = p.status === "PENDING" && p.createdById !== adminId;
                const canPay = p.status === "APPROVED" && p.approvedById !== adminId && p.createdById !== adminId;
                const canReject = p.status === "PENDING" || p.status === "APPROVED";
                return (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{p.user.name}</div>
                      <div className="text-xs text-muted">{p.user.email}</div>
                    </td>
                    <td className="px-4 py-2.5">{p.tradingAccount.template?.name ?? "—"}</td>
                    <td className="px-4 py-2.5 font-medium">{formatCurrency(p.amount, p.currency)}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">
                      {p.destination ? `${p.destination.type} ${p.destination.accountNumber} (${p.destination.accountName})` : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={p.status} />
                      {p.rejectReason && <div className="text-[10px] text-muted">{p.rejectReason}</div>}
                      {p.providerRef && <div className="text-[10px] text-muted">ref {p.providerRef}</div>}
                    </td>
                    <td className="px-4 py-2.5">{formatDateTime(p.requestedAt)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        {p.status === "PENDING" && (
                          <button className="btn-ghost !px-2 !py-1 text-xs text-success" disabled={!canApprove} title={canApprove ? "" : "The creator cannot approve their own request"} onClick={() => setDecision({ payout: p, status: "APPROVED" })}>
                            Approve
                          </button>
                        )}
                        {p.status === "APPROVED" && (
                          <button className="btn-ghost !px-2 !py-1 text-xs text-success" disabled={!canPay} title={canPay ? "" : "A different admin must mark it paid"} onClick={() => setDecision({ payout: p, status: "PAID" })}>
                            Mark paid
                          </button>
                        )}
                        {canReject && (
                          <button className="btn-ghost !px-2 !py-1 text-xs text-danger" onClick={() => setDecision({ payout: p, status: "REJECTED" })}>
                            Reject
                          </button>
                        )}
                        {!canReject && <span className="text-xs text-muted">—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={payouts.page} totalPages={payouts.totalPages} onChange={setPage} />
      </div>

      <DecisionModal decision={decision} onClose={() => setDecision(null)} onDone={() => { setDecision(null); loadPayouts(); }} />
      <RecordPayoutModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); loadPayouts(); }} />
    </div>
  );
}

function DecisionModal({ decision, onClose, onDone }: { decision: { payout: Payout; status: "APPROVED" | "PAID" | "REJECTED" } | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [providerRef, setProviderRef] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (!decision) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/payouts/${decision!.payout.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: decision!.status, reason: reason || undefined, providerRef: providerRef || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to update payout");
      toast.push(`Payout ${decision!.status.toLowerCase()}`, "success");
      setReason("");
      setProviderRef("");
      onDone();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Failed to update payout", "error");
    } finally {
      setBusy(false);
    }
  }

  const titles = { APPROVED: "Approve payout", PAID: "Mark payout as paid", REJECTED: "Reject payout" };
  return (
    <Modal open onClose={onClose} title={titles[decision.status]} widthClass="max-w-md">
      <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
        <p className="text-muted">
          {formatCurrency(decision.payout.amount, decision.payout.currency)} to {decision.payout.user.name}
          {decision.payout.destination ? ` · ${decision.payout.destination.type} ${decision.payout.destination.accountNumber}` : ""}
        </p>
        {decision.status === "PAID" && (
          <label className="flex flex-col gap-1">
            <span className="font-medium">Transfer reference (Chapa / bank)</span>
            <input className="input-base" value={providerRef} onChange={(e) => setProviderRef(e.target.value)} placeholder="e.g. Chapa transfer id" />
          </label>
        )}
        {decision.status === "REJECTED" && (
          <label className="flex flex-col gap-1">
            <span className="font-medium">Reason (shown to the trader)</span>
            <input className="input-base" value={reason} onChange={(e) => setReason(e.target.value)} required />
          </label>
        )}
        {decision.status === "PAID" && <p className="text-xs text-muted">Marking paid debits the trader&apos;s account balance by the payout amount and records a ledger entry.</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className={decision.status === "REJECTED" ? "btn-danger" : "btn-primary"} disabled={busy}>
            {busy ? "Saving..." : titles[decision.status]}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RecordPayoutModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [accounts, setAccounts] = useState<FundedAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    fetch("/api/admin/payouts/funded-accounts")
      .then((r) => r.json())
      .then((d) => setAccounts(d.items ?? []))
      .catch(() => undefined);
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradingAccountId: accountId, amount: Number(amount), note: note || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to record payout");
      toast.push("Payout request recorded (needs approval by another admin)", "success");
      setAccountId("");
      setAmount("");
      setNote("");
      onCreated();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Failed to record payout", "error");
    } finally {
      setSaving(false);
    }
  }

  const selected = accounts.find((a) => a.id === accountId);
  return (
    <Modal open={open} onClose={onClose} title="Record payout request">
      <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Funded account</span>
          <select className="input-base" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
            <option value="">Select account...</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.user.name} — available {formatCurrency(a.available, "ETB")}{a.kycApproved ? "" : " (KYC missing)"}
              </option>
            ))}
          </select>
        </label>
        {selected && !selected.eligible && <p className="text-xs text-warning">This account is not eligible yet (KYC, funded period or minimum amount).</p>}
        <label className="flex flex-col gap-1">
          <span className="font-medium">Amount (ETB)</span>
          <input type="number" min={500} step="0.01" className="input-base" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Note</span>
          <input className="input-base" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving || !accountId}>{saving ? "Recording..." : "Record request"}</button>
        </div>
      </form>
    </Modal>
  );
}
