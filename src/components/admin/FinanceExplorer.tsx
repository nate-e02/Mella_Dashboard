"use client";

import { useEffect, useState } from "react";
import { StatCard } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { RevenueAreaChart } from "@/components/ui/Charts";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";

type Stats = Awaited<ReturnType<typeof fetchStats>>;
type Payout = {
  id: string;
  amount: number;
  status: string;
  requestedAt: string;
  paidAt: string | null;
  user: { name: string; email: string };
  tradingAccount: { id: string; template: { name: string } | null };
};
type FundedAccount = { id: string; balance: number; startingBalance: number; user: { name: string; email: string } };

async function fetchStats() {
  const res = await fetch("/api/admin/overview-stats");
  return res.json() as Promise<{
    revenueToday: number;
    revenueMonth: number;
    revenueTotal: number;
    payoutsThisMonthSum: number;
    payoutsThisMonthCount: number;
    avgPayoutSize: number;
    refundRate: number;
  }>;
}

export function FinanceExplorer() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [revenueSeries, setRevenueSeries] = useState<{ date: string; revenue: number }[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [fundedAccounts, setFundedAccounts] = useState<FundedAccount[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const toast = useToast();

  async function load() {
    const [s, series, p, f] = await Promise.all([
      fetchStats(),
      fetch("/api/admin/revenue-series").then((r) => r.json()),
      fetch("/api/admin/payouts").then((r) => r.json()),
      fetch("/api/admin/payouts/funded-accounts").then((r) => r.json()),
    ]);
    setStats(s);
    setRevenueSeries(series);
    setPayouts(p);
    setFundedAccounts(f);
  }

  useEffect(() => {
    // Fetching finance data from the API on mount is exactly what effects
    // are for - the resulting setState calls happen after the awaited
    // requests resolve, not synchronously within this effect body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function decide(id: string, status: "PAID" | "REJECTED") {
    try {
      const res = await fetch(`/api/admin/payouts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      toast.push(`Payout marked ${status.toLowerCase()}`, "success");
      load();
    } catch {
      toast.push("Failed to update payout", "error");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Revenue Today" value={formatCurrency(stats?.revenueToday ?? 0)} />
        <StatCard label="Revenue This Month" value={formatCurrency(stats?.revenueMonth ?? 0)} />
        <StatCard label="Total Revenue" value={formatCurrency(stats?.revenueTotal ?? 0)} />
        <StatCard label="Refund Rate (30d)" value={`${(stats?.refundRate ?? 0).toFixed(1)}%`} />
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold">Revenue (last 30 days)</h3>
        <RevenueAreaChart data={revenueSeries} />
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold">Payouts</h3>
          <button className="btn-primary !py-1.5 text-xs" onClick={() => setCreateOpen(true)}>
            + Record Payout
          </button>
        </div>
        <table className="w-full min-w-[700px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">Trader</th>
              <th className="px-4 py-2.5">Account</th>
              <th className="px-4 py-2.5">Amount</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Requested</th>
              <th className="px-4 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {payouts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted">
                  No payouts recorded yet.
                </td>
              </tr>
            )}
            {payouts.map((p) => (
              <tr key={p.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2.5">
                  <div className="font-medium">{p.user.name}</div>
                  <div className="text-xs text-muted">{p.user.email}</div>
                </td>
                <td className="px-4 py-2.5">{p.tradingAccount.template?.name ?? "—"}</td>
                <td className="px-4 py-2.5">{formatCurrency(p.amount)}</td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={p.status} />
                </td>
                <td className="px-4 py-2.5">{formatDateTime(p.requestedAt)}</td>
                <td className="px-4 py-2.5">
                  {p.status === "PENDING" ? (
                    <div className="flex gap-1.5">
                      <button className="btn-ghost !px-2 !py-1 text-xs text-success" onClick={() => decide(p.id, "PAID")}>
                        Mark Paid
                      </button>
                      <button className="btn-ghost !px-2 !py-1 text-xs text-danger" onClick={() => decide(p.id, "REJECTED")}>
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RecordPayoutModal
        open={createOpen}
        accounts={fundedAccounts}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          load();
        }}
      />
    </div>
  );
}

function RecordPayoutModal({
  open,
  accounts,
  onClose,
  onCreated,
}: {
  open: boolean;
  accounts: FundedAccount[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/admin/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradingAccountId: accountId, amount: Number(amount) }),
      });
      if (!res.ok) throw new Error();
      toast.push("Payout recorded", "success");
      setAccountId("");
      setAmount("");
      onCreated();
    } catch {
      toast.push("Failed to record payout", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Record Payout">
      <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Funded Account</span>
          <select className="input-base" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
            <option value="">Select account...</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.user.name} — P&L {formatCurrency(a.balance - a.startingBalance)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Amount</span>
          <input type="number" min={1} step="0.01" className="input-base" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !accountId}>
            {saving ? "Recording..." : "Record Payout"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
