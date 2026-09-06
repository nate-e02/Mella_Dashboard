"use client";

import { useMemo, useState } from "react";
import type { Template } from "@prisma/client";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency } from "@/lib/format";

export function ChallengesGrid({ templates }: { templates: Template[] }) {
  const [selected, setSelected] = useState<Template | null>(null);

  if (templates.length === 0) {
    return (
      <div className="card p-10 text-center">
        <div className="text-sm font-medium">No challenges available right now.</div>
        <div className="mt-1 text-xs text-muted">Check back soon — new programs are added regularly.</div>
      </div>
    );
  }

  const groups = new Map<string, Template[]>();
  for (const t of templates) {
    const arr = groups.get(t.groupName) ?? [];
    arr.push(t);
    groups.set(t.groupName, arr);
  }

  return (
    <div className="flex flex-col gap-8">
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
                  <RuleRow label="Max Drawdown" value={`${t.maxDrawdown}%`} />
                  <RuleRow label="Daily Drawdown" value={`${t.dailyDrawdown}%`} />
                  <RuleRow label="Min Trading Days" value={String(t.minTradingDays)} />
                  <RuleRow label="Leverage" value={`1:${t.leverage}`} />
                  <RuleRow label="Duration" value={t.durationDays ? `${t.durationDays}d` : "Unlimited"} />
                </dl>
                <div className="mt-auto flex items-center justify-between pt-2">
                  <span className="text-xl font-semibold">{formatCurrency(t.price, t.currency)}</span>
                  <button className="btn-primary" onClick={() => setSelected(t)}>
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

function PurchaseModal({ template, onClose }: { template: Template | null; onClose: () => void }) {
  const [processing, setProcessing] = useState(false);
  const toast = useToast();
  const router = useRouter();

  // One key per purchase attempt (i.e. per template selected), stable across
  // retries of that same attempt (a failed submit followed by clicking "Pay"
  // again reuses it) so a slow network retry or double-click can never
  // create two payment attempts for the same checkout.
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
      if (!res.ok) {
        throw new Error(body.error || "Purchase failed");
      }
      if (body.outcome === "ALREADY_PAID") {
        toast.push("You already own this challenge.", "success");
        onClose();
        router.push("/purchases");
        return;
      }
      // Hand off to Chapa's hosted checkout - the account is only created
      // once the payment is verified server-side after checkout completes.
      window.location.href = body.checkoutUrl;
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Purchase failed", "error");
      setProcessing(false);
    }
  }

  return (
    <Modal open={!!template} onClose={onClose} title={`Purchase ${template.name}`}>
      <div className="flex flex-col gap-4 text-sm">
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
          You&apos;ll be redirected to Chapa to complete payment securely. Your challenge activates automatically once payment is confirmed.
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-4 py-3">
          <span className="text-sm text-muted">Total due</span>
          <span className="text-xl font-semibold">{formatCurrency(template.price, "ETB")}</span>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={processing}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={processing}>
            {processing ? "Redirecting to Chapa..." : `Pay with Chapa`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
