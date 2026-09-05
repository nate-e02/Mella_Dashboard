"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

const STATUSES = ["ACTIVE", "PASSED", "FAILED", "SUSPENDED", "FROZEN", "FUNDED"];

export function AccountAdminActions({ accountId, currentStatus }: { accountId: string; currentStatus: string }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [simBias, setSimBias] = useState("0.6");
  const router = useRouter();
  const toast = useToast();

  async function simulate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/simulate-trades`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: 10, winBias: Number(simBias) }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      toast.push(`Simulated 10 trades — status is now ${updated.status}`, "success");
      router.refresh();
    } catch {
      toast.push("Failed to simulate trades", "error");
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: string) {
    if (!status || status === currentStatus) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      toast.push("Status updated", "success");
      router.refresh();
    } catch {
      toast.push("Failed to update status", "error");
    } finally {
      setBusy(false);
    }
  }

  async function doReset() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/reset`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.push("Account reset", "success");
      setConfirmReset(false);
      router.refresh();
    } catch {
      toast.push("Failed to reset account", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select className="input-base !w-auto !py-1.5 text-xs" value="" onChange={(e) => changeStatus(e.target.value)} disabled={busy}>
        <option value="">Change status...</option>
        {STATUSES.filter((s) => s !== currentStatus).map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select className="input-base !w-auto !py-1.5 text-xs" value={simBias} onChange={(e) => setSimBias(e.target.value)} disabled={busy} title="Simulated win rate">
        <option value="0.8">Simulate: Strong Win Streak</option>
        <option value="0.6">Simulate: Winning</option>
        <option value="0.4">Simulate: Losing</option>
        <option value="0.15">Simulate: Breach Drawdown</option>
      </select>
      <button className="btn-secondary !py-1.5 text-xs" onClick={simulate} disabled={busy}>
        Run 10 Demo Trades
      </button>
      <button className="btn-secondary !py-1.5 text-xs" onClick={() => setConfirmReset(true)}>
        Reset Account
      </button>
      <ConfirmDialog
        open={confirmReset}
        title="Reset account?"
        description="This will delete all trades on this account and reset the balance/status to its starting configuration. This cannot be undone."
        confirmLabel="Reset"
        danger
        loading={busy}
        onConfirm={doReset}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
