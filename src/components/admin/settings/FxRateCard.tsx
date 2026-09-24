"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";

export function FxRateCard({ current }: { current: { rate: number; source: string; effectiveAt: string } | null }) {
  const [rate, setRate] = useState(current ? String(current.rate) : "");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/admin/settings/fx-rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rate: Number(rate), source: "MANUAL_NBE" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save rate");
      toast.push("USD/ETB rate updated (applies to new trade closes)", "success");
      router.refresh();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Could not save rate", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card flex max-w-md flex-col gap-3 p-5">
      <h3 className="text-sm font-semibold">USD → ETB valuation rate</h3>
      <p className="text-xs text-muted">
        Instruments are quoted in US dollars; challenge accounts are in birr. Enter the National Bank of Ethiopia reference rate daily. Every trade
        close records the rate that was applied, so results are reproducible. Changes are audit-logged.
      </p>
      {current ? (
        <p className="text-xs text-muted">
          Current: <span className="font-medium text-foreground">{current.rate}</span> ({current.source}, {formatDateTime(current.effectiveAt)})
        </p>
      ) : (
        <p className="text-xs text-warning">No rate set yet. The engine falls back to FX_USD_ETB_FALLBACK until one is saved.</p>
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">1 USD =</span>
        <input type="number" min={1} step="0.0001" className="input-base" value={rate} onChange={(e) => setRate(e.target.value)} required />
      </label>
      <button type="submit" className="btn-primary self-start" disabled={busy}>
        {busy ? "Saving..." : "Save rate"}
      </button>
    </form>
  );
}
