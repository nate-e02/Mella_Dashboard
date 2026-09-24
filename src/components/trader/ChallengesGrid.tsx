"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency } from "@/lib/format";
import type { StorefrontTemplate } from "@/lib/services/templates";

export function ChallengesGrid({ templates, emailVerified }: { templates: StorefrontTemplate[]; emailVerified: boolean }) {
  const [selected, setSelected] = useState<StorefrontTemplate | null>(null);

  if (templates.length === 0) {
    return (
      <div className="card p-10 text-center">
        <div className="text-sm font-medium">No challenges available right now.</div>
        <div className="mt-1 text-xs text-muted">Check back soon — new programs are added regularly.</div>
      </div>
    );
  }

  const groups = new Map<string, StorefrontTemplate[]>();
  for (const t of templates) {
    const arr = groups.get(t.groupName) ?? [];
    arr.push(t);
    groups.set(t.groupName, arr);
  }

  return (
    <div className="flex flex-col gap-8">
      {!emailVerified && (
        <div className="card border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Verify your email address (Account page) before purchasing a challenge.
        </div>
      )}
      {Array.from(groups.entries()).map(([groupName, items]) => (
        <div key={groupName}>
          <h2 className="mb-3 text-lg font-semibold">{groupName}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((t) => (
              <div key={t.id} className="card flex flex-col gap-3 p-5">
                <div>
                  <div className="text-sm text-muted">Account Size</div>
                  <div className="text-2xl font-semibold">{formatCurrency(t.accountSize, t.accountCurrency)}</div>
                </div>
                <p className="text-sm text-muted line-clamp-2">{t.description}</p>
                <dl className="grid grid-cols-2 gap-y-1 text-xs">
                  <RuleRow label="Profit Target" value={t.profitTarget != null ? `${t.profitTarget}%` : "—"} />
                  <RuleRow label="Profit Split" value={`${t.profitSplit}%`} />
                  <RuleRow label="Max Loss" value={`${t.maxDrawdown}% ${t.drawdownMode === "TRAILING" ? "(trailing)" : "(static)"}`} />
                  <RuleRow label="Daily Loss" value={`${t.dailyDrawdown}%`} />
                  <RuleRow label="Min Trading Days" value={String(t.minTradingDays)} />
                  <RuleRow label="Leverage" value={`1:${t.leverage}`} />
                  <RuleRow label="Duration" value={t.durationDays ? `${t.durationDays}d` : "Unlimited"} />
                  <RuleRow label="Weekend / News" value={`${t.weekendHoldingAllowed ? "✓" : "✗"} / ${t.newsTradingAllowed ? "✓" : "✗"}`} />
                </dl>
                <div className="mt-auto flex items-center justify-between pt-2">
                  <span className="text-xl font-semibold">{formatCurrency(t.price, t.currency)}</span>
                  <button className="btn-primary" onClick={() => setSelected(t)} disabled={!emailVerified}>
                    Purchase
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <PurchaseModal template={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function RuleRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </>
  );
}

function PurchaseModal({ template, onClose }: { template: StorefrontTemplate | null; onClose: () => void }) {
  const [processing, setProcessing] = useState(false);
  const toast = useToast();
  const router = useRouter();

  // One key per purchase attempt, stable across retries of that attempt, so
  // a double-click or network retry can never create two payment attempts.
  const idempotencyKey = useMemo(() => `${template?.id}-${crypto.randomUUID()}`, [template?.id]);

  if (!template) return null;

  async function submit() {
    setProcessing(true);
    try {
      const res = await fetch("/api/trader/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template!.id, idempotencyKey }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Purchase failed");
      if (body.outcome === "ALREADY_PAID") {
        toast.push("You already own this challenge.", "success");
        onClose();
        router.push("/purchases");
        return;
      }
      // Only Chapa's hosted checkout is an acceptable destination.
      const url = String(body.checkoutUrl ?? "");
      if (!/^https:\/\/([a-z0-9-]+\.)*chapa\.co\//i.test(url)) throw new Error("Unexpected checkout address");
      window.location.href = url;
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Purchase failed", "error");
      setProcessing(false);
    }
  }

  return (
    <Modal open={!!template} onClose={onClose} title={`Purchase ${template.name}`}>
      <div className="flex flex-col gap-4 text-sm">
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
          You&apos;ll be redirected to Chapa to pay with telebirr, CBE Birr, M-Pesa or a bank card. Your challenge activates automatically once payment is confirmed.
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-4 py-3">
          <span className="text-sm text-muted">Total due</span>
          <span className="text-xl font-semibold">{formatCurrency(template.price, template.currency)}</span>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={processing}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={processing}>
            {processing ? "Redirecting to Chapa..." : "Pay with Chapa"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
