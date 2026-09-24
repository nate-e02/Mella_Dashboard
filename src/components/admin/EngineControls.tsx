"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

export function EngineControls({ reachable, halted }: { reachable: boolean; halted: boolean }) {
  const [confirm, setConfirm] = useState<"halt" | "resume" | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();

  async function run(action: "halt" | "resume") {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/engine", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Engine request failed");
      toast.push(action === "halt" ? "Trading halted" : "Trading resumed", "success");
      setConfirm(null);
      router.refresh();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Engine request failed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button className="btn-secondary !py-1.5 text-xs" onClick={() => router.refresh()}>
        Refresh
      </button>
      {halted ? (
        <button className="btn-primary !py-1.5 text-xs" onClick={() => setConfirm("resume")} disabled={!reachable || busy}>
          Resume trading
        </button>
      ) : (
        <button className="btn-danger !py-1.5 text-xs" onClick={() => setConfirm("halt")} disabled={!reachable || busy}>
          Halt trading (kill switch)
        </button>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "halt" ? "Halt all trading?" : "Resume trading?"}
        description={
          confirm === "halt"
            ? "New orders are rejected and breach evaluation pauses until trading is resumed. Open positions stay open. This is audit-logged."
            : "Orders will be accepted again and risk evaluation resumes."
        }
        confirmLabel={confirm === "halt" ? "Halt" : "Resume"}
        danger={confirm === "halt"}
        loading={busy}
        onConfirm={() => confirm && run(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
