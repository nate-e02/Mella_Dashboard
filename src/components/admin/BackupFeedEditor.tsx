"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

const SOURCES = ["", "TRADERMADE", "CTRADER", "BINANCE", "STUB2"] as const;

/** Sets or clears an instrument's hot-standby feed (PATCH /api/admin/instruments/[symbol], audited). */
export function BackupFeedEditor({ symbol, primary, backupSource, backupSymbol }: { symbol: string; primary: string; backupSource: string | null; backupSymbol: string | null }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState(backupSource ?? "");
  const [feedSymbol, setFeedSymbol] = useState(backupSymbol ?? "");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/instruments/${encodeURIComponent(symbol)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backupFeedSource: source || null, backupFeedSymbol: feedSymbol.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Update failed");
      toast.push(source ? `${symbol}: backup feed ${source}` : `${symbol}: backup feed removed`, "success");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Update failed", "error");
    } finally {
      setBusy(false);
    }
  }

  const options = SOURCES.filter((s) => s !== primary.toUpperCase());
  return (
    <>
      <button type="button" className="btn-ghost !px-2 !py-0.5 text-[11px]" onClick={() => setOpen(true)} aria-label={`Edit backup feed for ${symbol}`}>
        Edit
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Backup feed · ${symbol}`}>
        <form className="flex flex-col gap-3" onSubmit={save}>
          <p className="text-xs text-muted">
            Primary: <span className="font-mono">{primary}</span>. The worker switches to the backup when the primary is silent for FEED_FAILOVER_STALE_MS while the
            backup is ticking, and back after the primary has been healthy for FEED_FAILBACK_STABLE_MS.
          </p>
          <label className="text-xs text-muted" htmlFor={`bk-src-${symbol}`}>
            Backup source
          </label>
          <select id={`bk-src-${symbol}`} className="input-base" value={source} onChange={(e) => setSource(e.target.value)}>
            {options.map((s) => (
              <option key={s} value={s}>
                {s || "None"}
              </option>
            ))}
          </select>
          <label className="text-xs text-muted" htmlFor={`bk-sym-${symbol}`}>
            Provider symbol (blank = same as the primary feed symbol)
          </label>
          <input id={`bk-sym-${symbol}`} className="input-base font-mono" value={feedSymbol} onChange={(e) => setFeedSymbol(e.target.value)} placeholder={symbol} disabled={!source} maxLength={64} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary !py-1.5 text-xs" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
