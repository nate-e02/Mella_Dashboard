"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

/** Mirrors isLegalManualTransition in challengeRules.ts (PASSED is never set by hand). */
function allowedTargets(status: string, phase: string): string[] {
  const reinstate = phase === "FUNDED" ? "FUNDED" : "ACTIVE";
  switch (status) {
    case "ACTIVE":
    case "FUNDED":
      return ["SUSPENDED", "FROZEN", "FAILED"];
    case "SUSPENDED":
    case "FROZEN":
      return [reinstate, status === "SUSPENDED" ? "FROZEN" : "SUSPENDED", "FAILED"];
    case "FAILED":
      return [reinstate];
    default:
      return [];
  }
}

export function AccountAdminActions({
  accountId,
  currentStatus,
  phase,
  devOverrides,
  hasNextAccount,
}: {
  accountId: string;
  currentStatus: string;
  phase: string;
  devOverrides: boolean;
  hasNextAccount: boolean;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [reason, setReason] = useState("");
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

  async function applyStatus() {
    if (!pendingStatus) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: pendingStatus, reason: reason || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to update status");
      toast.push(`Status changed to ${pendingStatus}`, "success");
      setPendingStatus(null);
      setReason("");
      router.refresh();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Failed to update status", "error");
    } finally {
      setBusy(false);
    }
  }

  async function doReset() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}/reset`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to reset account");
      toast.push("Account reset (history archived)", "success");
      setConfirmReset(false);
      router.refresh();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Failed to reset account", "error");
    } finally {
      setBusy(false);
    }
  }

  const targets = allowedTargets(currentStatus, phase);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="status-change">
        Change account status
      </label>
      <select id="status-change" className="input-base !w-auto !py-1.5 text-xs" value="" onChange={(e) => e.target.value && setPendingStatus(e.target.value)} disabled={busy || targets.length === 0}>
        <option value="">{targets.length === 0 ? "No status changes available" : "Change status..."}</option>
        {targets.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      {devOverrides && (
        <>
          <select className="input-base !w-auto !py-1.5 text-xs" value={simBias} onChange={(e) => setSimBias(e.target.value)} disabled={busy} aria-label="Simulated win rate">
            <option value="0.8">Simulate: Strong Win Streak</option>
            <option value="0.6">Simulate: Winning</option>
            <option value="0.4">Simulate: Losing</option>
            <option value="0.15">Simulate: Breach Drawdown</option>
          </select>
          <button className="btn-secondary !py-1.5 text-xs" onClick={simulate} disabled={busy} title="DEV ONLY">
            Run 10 Demo Trades
          </button>
        </>
      )}
      <button className="btn-secondary !py-1.5 text-xs" onClick={() => setConfirmReset(true)} disabled={hasNextAccount}>
        Reset Account
      </button>

      <ConfirmDialog
        open={!!pendingStatus}
        title={`Set status to ${pendingStatus}?`}
        description={
          pendingStatus === "ACTIVE" || pendingStatus === "FUNDED"
            ? "Reinstating re-anchors the drawdown and daily-loss references to the current equity. Add a reason for the audit log."
            : "This is recorded in the audit log and the trader is notified. Add a reason."
        }
        confirmLabel="Apply"
        danger={pendingStatus === "FAILED"}
        loading={busy}
        onConfirm={applyStatus}
        onCancel={() => setPendingStatus(null)}
      >
        <input className="input-base mt-3" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmReset}
        title="Reset account?"
        description="Archives all trades and closes open positions, then resets the balance and status to the starting configuration. History is kept for audit."
        confirmLabel="Reset"
        danger
        loading={busy}
        onConfirm={doReset}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
