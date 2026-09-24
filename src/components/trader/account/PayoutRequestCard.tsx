"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { StatusBadge } from "@/components/ui/Badge";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useT } from "@/i18n/client";

type FundedAccount = { id: string; name: string };
type Availability = {
  available: number;
  profit: number;
  traderShare: number;
  alreadyCommitted: number;
  profitSplitPercent: number;
  kycApproved: boolean;
  fundedDays: number;
  eligible: boolean;
  minPayout: number;
  minFundedDays: number;
};
type Payout = { id: string; amount: number; currency: string; status: string; requestedAt: string; paidAt: string | null; tradingAccount: { template: { name: string } | null } };

export function PayoutRequestCard({ fundedAccounts }: { fundedAccounts: FundedAccount[] }) {
  const t = useT();
  const [accountId, setAccountId] = useState(fundedAccounts[0]?.id ?? "");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [amount, setAmount] = useState("");
  const [destType, setDestType] = useState<"TELEBIRR" | "CBE_BIRR" | "BANK">("TELEBIRR");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function loadPayouts() {
    const res = await fetch("/api/trader/payouts");
    if (res.ok) setPayouts(await res.json());
  }

  useEffect(() => {
    // Loading server data on mount / account change is what effects are for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPayouts();
    if (!accountId) return;
    fetch(`/api/trader/payouts/availability?accountId=${encodeURIComponent(accountId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setAvailability)
      .catch(() => setAvailability(null));
  }, [accountId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/trader/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tradingAccountId: accountId,
          amount: Number(amount),
          destination: { type: destType, accountNumber, accountName },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || body.issues?.[0]?.message || t("auth.payouts.failed"));
      toast.push(t("auth.payouts.requested"), "success");
      setAmount("");
      await loadPayouts();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("auth.payouts.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div>
        <h3 className="text-sm font-semibold">{t("auth.payouts.title")}</h3>
        <p className="text-xs text-muted">{t("auth.payouts.subtitle")}</p>
      </div>

      {fundedAccounts.length === 0 ? (
        <p className="text-sm text-muted">{t("auth.payouts.none")}</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="font-medium">{t("auth.payouts.account")}</span>
            <select className="input-base" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {fundedAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {availability && (
            <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
              <div>
                {t("auth.payouts.summary", {
                  profit: formatCurrency(availability.profit, "ETB"),
                  percent: availability.profitSplitPercent,
                  share: formatCurrency(availability.traderShare, "ETB"),
                  committed: formatCurrency(availability.alreadyCommitted, "ETB"),
                })}
              </div>
              <div className="mt-1 font-medium text-foreground">{t("auth.payouts.available", { amount: formatCurrency(availability.available, "ETB") })}</div>
              {!availability.kycApproved && <div className="mt-1 text-warning">{t("auth.payouts.kycRequired")}</div>}
              {availability.fundedDays < availability.minFundedDays && (
                <div className="mt-1 text-warning">{t("auth.payouts.minDays", { minDays: availability.minFundedDays, days: availability.fundedDays })}</div>
              )}
              {availability.available < availability.minPayout && <div className="mt-1">{t("auth.payouts.minAmount", { amount: formatCurrency(availability.minPayout, "ETB") })}</div>}
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className="font-medium">{t("auth.payouts.amount")}</span>
            <input type="number" min={availability?.minPayout ?? 500} step="0.01" className="input-base" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="font-medium">{t("auth.payouts.payTo")}</span>
              <select className="input-base" value={destType} onChange={(e) => setDestType(e.target.value as typeof destType)}>
                <option value="TELEBIRR">telebirr</option>
                <option value="CBE_BIRR">CBE Birr</option>
                <option value="BANK">{t("auth.payouts.bank")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">{destType === "BANK" ? t("auth.payouts.accountNumber") : t("auth.payouts.phoneNumber")}</span>
              <input className="input-base" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} required minLength={6} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">{t("auth.payouts.accountName")}</span>
              <input className="input-base" value={accountName} onChange={(e) => setAccountName(e.target.value)} required minLength={2} />
            </label>
          </div>
          <button type="submit" className="btn-primary self-start" disabled={busy || !availability?.eligible}>
            {busy ? t("auth.payouts.submitting") : t("auth.payouts.submit")}
          </button>
        </form>
      )}

      {payouts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-left uppercase tracking-wide text-muted">
                <th className="py-2 pr-3">{t("auth.payouts.col.account")}</th>
                <th className="py-2 pr-3">{t("common.amount")}</th>
                <th className="py-2 pr-3">{t("common.status")}</th>
                <th className="py-2 pr-3">{t("auth.payouts.col.requested")}</th>
                <th className="py-2">{t("auth.payouts.col.paid")}</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="py-2 pr-3">{p.tradingAccount.template?.name ?? "—"}</td>
                  <td className="py-2 pr-3">{formatCurrency(p.amount, p.currency)}</td>
                  <td className="py-2 pr-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="py-2 pr-3">{formatDateTime(p.requestedAt)}</td>
                  <td className="py-2">{formatDateTime(p.paidAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
