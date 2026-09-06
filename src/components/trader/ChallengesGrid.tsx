"use client";

import { useMemo, useState } from "react";
import type { Template } from "@prisma/client";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency } from "@/lib/format";

const DEMO_AMOUNTS = [50, 100, 200, 500];

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
                    Purchase (Demo)
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
  const [amount, setAmount] = useState<number>(template?.price ?? 0);
  const [custom, setCustom] = useState("");
  const [processing, setProcessing] = useState(false);
  const router = useRouter();
  const toast = useToast();

  // One key per purchase attempt (i.e. per template selected), stable across
  // retries of that same attempt (a failed submit followed by clicking "Pay"
  // again reuses it) so a slow network retry or double-click can never
  // create two purchases/accounts for the same checkout.
  const idempotencyKey = useMemo(() => `${template?.id}-${crypto.randomUUID()}`, [template?.id]);

  if (!template) return null;

  async function submit() {
    setProcessing(true);
    try {
      const finalAmount = custom ? Number(custom) : amount;
      const res = await fetch("/api/trader/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template!.id, amount: finalAmount, idempotencyKey }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Purchase failed");
      }
      toast.push("Demo payment successful — your account is now active!", "success");
      onClose();
      router.push("/purchases");
      router.refresh();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Purchase failed", "error");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <Modal open={!!template} onClose={onClose} title={`Purchase ${template.name}`}>
      <div className="flex flex-col gap-4 text-sm">
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          DEMO PAYMENT — no real money is charged. This simulates a successful checkout.
        </div>
        <div>
          <div className="mb-2 font-medium">Select a demo payment amount</div>
          <div className="grid grid-cols-4 gap-2">
            {DEMO_AMOUNTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => {
                  setAmount(a);
                  setCustom("");
                }}
                className={`rounded-lg border px-2 py-2 text-sm font-medium ${
                  !custom && amount === a ? "border-accent-2 bg-accent-2/15 text-accent-2" : "border-border bg-surface-2"
                }`}
              >
                ${a}
              </button>
            ))}
          </div>
          <label className="mt-2 flex flex-col gap-1">
            <span className="text-xs text-muted">Or enter a custom demo amount</span>
            <input type="number" min={1} className="input-base" placeholder={`Suggested: ${formatCurrency(template.price, template.currency)}`} value={custom} onChange={(e) => setCustom(e.target.value)} />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={processing}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={processing}>
            {processing ? "Processing demo payment..." : `Pay ${formatCurrency(custom ? Number(custom) : amount, template.currency)}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
