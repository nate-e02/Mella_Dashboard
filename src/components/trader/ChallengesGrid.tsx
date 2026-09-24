"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency } from "@/lib/format";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/messages";
import type { StorefrontTemplate } from "@/lib/services/templates";

export function ChallengesGrid({ templates, emailVerified }: { templates: StorefrontTemplate[]; emailVerified: boolean }) {
  const [selected, setSelected] = useState<StorefrontTemplate | null>(null);
  const t = useT();

  if (templates.length === 0) {
    return (
      <div className="card p-10 text-center">
        <div className="text-sm font-medium">{t("growth.challenges.empty.title")}</div>
        <div className="mt-1 text-xs text-muted">{t("growth.challenges.empty.body")}</div>
      </div>
    );
  }

  const groups = new Map<string, StorefrontTemplate[]>();
  for (const tpl of templates) {
    const arr = groups.get(tpl.groupName) ?? [];
    arr.push(tpl);
    groups.set(tpl.groupName, arr);
  }

  return (
    <div className="flex flex-col gap-8">
      {!emailVerified && (
        <div className="card border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">{t("growth.challenges.verifyFirst")}</div>
      )}
      {Array.from(groups.entries()).map(([groupName, items]) => (
        <div key={groupName}>
          <h2 className="mb-3 text-lg font-semibold">{groupName}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((tpl) => (
              <div key={tpl.id} className="card flex flex-col gap-3 p-5">
                <div>
                  <div className="text-sm text-muted">{t("growth.challenges.accountSize")}</div>
                  <div className="text-2xl font-semibold">{formatCurrency(tpl.accountSize, tpl.accountCurrency)}</div>
                </div>
                <p className="text-sm text-muted line-clamp-2">{tpl.description}</p>
                <dl className="grid grid-cols-2 gap-y-1 text-xs">
                  <RuleRow label={t("growth.challenges.rule.profitTarget")} value={tpl.profitTarget != null ? `${tpl.profitTarget}%` : "—"} />
                  <RuleRow label={t("growth.challenges.rule.profitSplit")} value={`${tpl.profitSplit}%`} />
                  <RuleRow
                    label={t("growth.challenges.rule.maxLoss")}
                    value={`${tpl.maxDrawdown}% ${tpl.drawdownMode === "TRAILING" ? t("growth.challenges.rule.trailing") : t("growth.challenges.rule.static")}`}
                  />
                  <RuleRow label={t("growth.challenges.rule.dailyLoss")} value={`${tpl.dailyDrawdown}%`} />
                  <RuleRow label={t("growth.challenges.rule.minTradingDays")} value={String(tpl.minTradingDays)} />
                  <RuleRow label={t("growth.challenges.rule.leverage")} value={`1:${tpl.leverage}`} />
                  <RuleRow
                    label={t("growth.challenges.rule.duration")}
                    value={tpl.durationDays ? t("growth.challenges.rule.days", { n: tpl.durationDays }) : t("growth.challenges.rule.unlimited")}
                  />
                  <RuleRow label={t("growth.challenges.rule.weekendNews")} value={`${tpl.weekendHoldingAllowed ? "✓" : "✗"} / ${tpl.newsTradingAllowed ? "✓" : "✗"}`} />
                </dl>
                <div className="mt-auto flex items-center justify-between pt-2">
                  <span className="text-xl font-semibold">{formatCurrency(tpl.price, tpl.currency)}</span>
                  <button className="btn-primary" onClick={() => setSelected(tpl)} disabled={!emailVerified}>
                    {t("growth.challenges.purchase")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Keyed so each opened template starts with a fresh coupon state. */}
      <PurchaseModal key={selected?.id ?? "none"} template={selected} onClose={() => setSelected(null)} />
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

type CouponReason = "NOT_FOUND" | "INACTIVE" | "NOT_STARTED" | "EXPIRED" | "EXHAUSTED" | "USER_LIMIT" | "NOT_APPLICABLE";
type AppliedCoupon = { code: string; listPrice: number; discount: number; finalAmount: number };

function PurchaseModal({ template, onClose }: { template: StorefrontTemplate | null; onClose: () => void }) {
  const [processing, setProcessing] = useState(false);
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [applied, setApplied] = useState<AppliedCoupon | null>(null);
  const toast = useToast();
  const router = useRouter();
  const t = useT();

  // One key per purchase attempt, stable across retries of that attempt, so
  // a double-click or network retry can never create two payment attempts.
  // A different coupon is a different attempt (the server keeps the price an
  // attempt was first quoted), so it gets a fresh key.
  const idempotencyKey = useMemo(() => `${template?.id}-${applied?.code ?? "none"}-${crypto.randomUUID()}`, [template?.id, applied?.code]);

  if (!template) return null;

  const reasonText = (reason: string | undefined) =>
    reason ? t(`growth.coupon.reason.${reason as CouponReason}` as MessageKey) : t("growth.coupon.error");

  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code) return;
    setChecking(true);
    setCouponError(null);
    try {
      const res = await fetch("/api/trader/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, templateId: template!.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 429) throw new Error(t("growth.coupon.tooMany"));
      if (!res.ok) throw new Error(t("growth.coupon.error"));
      if (!body.valid) {
        setApplied(null);
        setCouponError(reasonText(body.reason));
        return;
      }
      setApplied({ code: body.code, listPrice: body.listPrice, discount: body.discount, finalAmount: body.finalAmount });
    } catch (err) {
      setCouponError(err instanceof Error ? err.message : t("growth.coupon.error"));
    } finally {
      setChecking(false);
    }
  }

  function removeCoupon() {
    setApplied(null);
    setCouponInput("");
    setCouponError(null);
  }

  async function submit() {
    setProcessing(true);
    try {
      const res = await fetch("/api/trader/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template!.id, idempotencyKey, ...(applied ? { couponCode: applied.code } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.code === "COUPON_INVALID") {
          // The coupon changed between the quote and the payment (expired, used up...).
          setApplied(null);
          setCouponOpen(true);
          setCouponError(reasonText(body.reason));
          setProcessing(false);
          return;
        }
        if (body.code === "CONTACT_UNVERIFIED" || body.code === "EMAIL_UNVERIFIED") throw new Error(t("growth.challenges.verifyFirst"));
        throw new Error(body.error || t("growth.checkout.failed"));
      }
      if (body.outcome === "ALREADY_PAID" || body.outcome === "ACTIVATED") {
        toast.push(t(body.outcome === "ACTIVATED" ? "growth.checkout.activated" : "growth.checkout.alreadyPaid"), "success");
        onClose();
        router.push("/purchases");
        router.refresh();
        return;
      }
      // Only Chapa's hosted checkout is an acceptable destination.
      const url = String(body.checkoutUrl ?? "");
      if (!/^https:\/\/([a-z0-9-]+\.)*chapa\.co\//i.test(url)) throw new Error(t("growth.checkout.badCheckout"));
      window.location.href = url;
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("growth.checkout.failed"), "error");
      setProcessing(false);
    }
  }

  const total = applied ? applied.finalAmount : template.price;
  const free = applied != null && applied.finalAmount <= 0;

  return (
    <Modal open={!!template} onClose={onClose} title={t("growth.checkout.title", { name: template.name })}>
      <div className="flex flex-col gap-4 text-sm">
        {!free && <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">{t("growth.checkout.chapaNote")}</div>}

        {!couponOpen && !applied ? (
          <button type="button" className="self-start text-xs font-medium text-accent-2 underline-offset-2 hover:underline" onClick={() => setCouponOpen(true)}>
            {t("growth.coupon.toggle")}
          </button>
        ) : applied ? (
          <div className="flex items-center justify-between rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
            <span>{t("growth.coupon.applied", { code: applied.code })}</span>
            <button type="button" className="btn-ghost !px-2 !py-0.5 text-xs" onClick={removeCoupon} disabled={processing}>
              {t("growth.coupon.remove")}
            </button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              applyCoupon();
            }}
          >
            <label htmlFor="coupon-code" className="text-xs font-medium text-muted">
              {t("growth.coupon.label")}
            </label>
            <div className="flex gap-2">
              <input
                id="coupon-code"
                className="input-base uppercase"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value)}
                placeholder={t("growth.coupon.placeholder")}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={32}
                aria-invalid={!!couponError}
                aria-describedby={couponError ? "coupon-error" : undefined}
              />
              <button type="submit" className="btn-secondary shrink-0" disabled={checking || !couponInput.trim()}>
                {checking ? t("growth.coupon.checking") : t("growth.coupon.apply")}
              </button>
            </div>
            {couponError && (
              <p id="coupon-error" role="alert" className="text-xs text-danger">
                {couponError}
              </p>
            )}
          </form>
        )}

        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 px-4 py-3">
          {applied && (
            <>
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{t("growth.coupon.listPrice")}</span>
                <span className="line-through">{formatCurrency(applied.listPrice, template.currency)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-success">
                <span>{t("growth.coupon.discount", { code: applied.code })}</span>
                <span>−{formatCurrency(applied.discount, template.currency)}</span>
              </div>
            </>
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">{t("growth.checkout.totalDue")}</span>
            <span className="text-xl font-semibold">{formatCurrency(total, template.currency)}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose} disabled={processing}>
            {t("common.cancel")}
          </button>
          <button className="btn-primary" onClick={submit} disabled={processing || checking}>
            {free
              ? processing
                ? t("growth.checkout.activating")
                : t("growth.checkout.activateFree")
              : processing
                ? t("growth.checkout.redirecting")
                : t("growth.checkout.pay")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
