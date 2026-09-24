"use client";

import { useCallback, useEffect, useState } from "react";
import { StatCard } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { FilterTabs } from "@/components/ui/Toolbar";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency, formatDateTime } from "@/lib/format";

type Reward = {
  id: string;
  amount: number;
  percent: number;
  currency: string;
  status: "PENDING" | "APPROVED" | "PAID" | "VOID";
  note: string | null;
  createdAt: string;
  approvedById: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  referrer: { id: string; name: string; email: string | null; phone: string | null };
  referredUser: { id: string; name: string };
  purchase: { id: string; amount: number; status: string; template: { name: string } | null };
};
type Summary = Partial<Record<Reward["status"], { amount: number; count: number }>>;
type Paged = { items: Reward[]; total: number; page: number; totalPages: number; summary: Summary };
type Action = "APPROVE" | "PAY" | "VOID";

const TABS = [
  { label: "Pending", value: "PENDING" },
  { label: "Approved", value: "APPROVED" },
  { label: "Paid", value: "PAID" },
  { label: "Void", value: "VOID" },
  { label: "All", value: "ALL" },
];

export function ReferralsExplorer({ adminId }: { adminId: string }) {
  const [status, setStatus] = useState("PENDING");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged>({ items: [], total: 0, page: 1, totalPages: 1, summary: {} });
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState<{ reward: Reward; action: Action } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/referrals?status=${status}&page=${page}&pageSize=20`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [status, page]);

  useEffect(() => {
    // Loading server data whenever the filter/page changes is what effects are for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const s = data.summary;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Pending" value={formatCurrency(s.PENDING?.amount ?? 0)} sublabel={`${s.PENDING?.count ?? 0} rewards`} tone="warning" />
        <StatCard label="Approved (to pay)" value={formatCurrency(s.APPROVED?.amount ?? 0)} sublabel={`${s.APPROVED?.count ?? 0} rewards`} />
        <StatCard label="Paid" value={formatCurrency(s.PAID?.amount ?? 0)} sublabel={`${s.PAID?.count ?? 0} rewards`} tone="success" />
        <StatCard label="Void" value={formatCurrency(s.VOID?.amount ?? 0)} sublabel={`${s.VOID?.count ?? 0} rewards`} />
      </div>

      <CommissionSetting />

      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3 sm:flex-row sm:items-center">
          <h3 className="text-sm font-semibold">Rewards</h3>
          <FilterTabs
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={TABS}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">Referrer</th>
                <th className="px-4 py-2.5">Referred trader</th>
                <th className="px-4 py-2.5">Purchase</th>
                <th className="px-4 py-2.5">Reward</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Created</th>
                <th className="px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading && data.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted">
                    No rewards in this view.
                  </td>
                </tr>
              )}
              {data.items.map((r) => {
                const own = r.referrer.id === adminId;
                const canPay = r.status === "APPROVED" && r.approvedById !== adminId && !own;
                return (
                  <tr key={r.id} className="border-b border-border/60 last:border-0 align-top">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{r.referrer.name}</div>
                      <div className="text-xs text-muted">{r.referrer.phone ?? r.referrer.email ?? "—"}</div>
                    </td>
                    <td className="px-4 py-2.5">{r.referredUser.name}</td>
                    <td className="px-4 py-2.5">
                      <div>{r.purchase.template?.name ?? "—"}</div>
                      <div className="text-xs text-muted">
                        {formatCurrency(r.purchase.amount)} · {r.purchase.status}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{formatCurrency(r.amount, r.currency)}</div>
                      <div className="text-xs text-muted">{r.percent}%</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={r.status} />
                      {r.note && <div className="mt-1 max-w-[220px] whitespace-pre-line text-[10px] text-muted">{r.note}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-xs">{formatDateTime(r.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        {r.status === "PENDING" && (
                          <button className="btn-ghost !px-2 !py-1 text-xs text-success" disabled={own} title={own ? "You cannot decide your own reward" : ""} onClick={() => setDecision({ reward: r, action: "APPROVE" })}>
                            Approve
                          </button>
                        )}
                        {r.status === "APPROVED" && (
                          <button className="btn-ghost !px-2 !py-1 text-xs text-success" disabled={!canPay} title={canPay ? "" : "A different admin must mark it paid"} onClick={() => setDecision({ reward: r, action: "PAY" })}>
                            Mark paid
                          </button>
                        )}
                        {(r.status === "PENDING" || r.status === "APPROVED") && (
                          <button className="btn-ghost !px-2 !py-1 text-xs text-danger" disabled={own} onClick={() => setDecision({ reward: r, action: "VOID" })}>
                            Void
                          </button>
                        )}
                        {(r.status === "PAID" || r.status === "VOID") && <span className="text-xs text-muted">—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
      </div>

      {decision && (
        <DecisionModal
          decision={decision}
          onClose={() => setDecision(null)}
          onDone={() => {
            setDecision(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function DecisionModal({ decision, onClose, onDone }: { decision: { reward: Reward; action: Action }; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [providerRef, setProviderRef] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { reward, action } = decision;
  const titles = { APPROVE: "Approve reward", PAY: "Mark reward as paid", VOID: "Void reward" };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/referrals/${reward.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: note || undefined, providerRef: providerRef || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to update reward");
      toast.push(titles[action].replace(" reward", "") + " — done", "success");
      onDone();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Failed to update reward", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={titles[action]} widthClass="max-w-md">
      <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
        <p className="text-muted">
          {formatCurrency(reward.amount, reward.currency)} to {reward.referrer.name}
          {reward.referrer.phone ? ` · ${reward.referrer.phone}` : ""}
        </p>
        {action === "PAY" && (
          <label className="flex flex-col gap-1">
            <span className="font-medium">Transfer reference (telebirr / bank)</span>
            <input className="input-base" value={providerRef} onChange={(e) => setProviderRef(e.target.value)} maxLength={120} required placeholder="e.g. telebirr transaction id" />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="font-medium">{action === "VOID" ? "Reason (required)" : "Note (optional)"}</span>
          <input className="input-base" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} required={action === "VOID"} />
        </label>
        {action === "PAY" && <p className="text-xs text-muted">Marking paid records a ledger debit and notifies the referrer. It cannot be undone.</p>}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={action === "VOID" ? "btn-danger" : "btn-primary"} disabled={busy}>
            {busy ? "Saving..." : titles[action]}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CommissionSetting() {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    fetch("/api/admin/referrals/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { commissionPercent: number } | null) => {
        if (!d) return;
        setSaved(d.commissionPercent);
        setValue(String(d.commissionPercent));
      })
      .catch(() => undefined);
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/admin/referrals/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commissionPercent: Number(value) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to save");
      setSaved(body.commissionPercent);
      toast.push(`Commission set to ${body.commissionPercent}%`, "success");
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h3 className="text-sm font-semibold">Commission</h3>
        <p className="text-xs text-muted">Percent of the amount actually paid (after coupons) credited to the referrer. Applies to purchases paid from now on (0–50%).</p>
      </div>
      <div className="flex items-center gap-2">
        <input type="number" min={0} max={50} step="0.5" className="input-base w-28" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Commission percent" required />
        <span className="text-muted">%</span>
        <button type="submit" className="btn-primary" disabled={busy || value === "" || Number(value) === saved}>
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
