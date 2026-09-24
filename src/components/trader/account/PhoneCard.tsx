"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { otpErrorMessage, postJson, sanitizeCode, useCountdown, useWebOtp } from "@/components/shared/otpClient";

type Mode = "view" | "enter" | "code";

/**
 * Shows the account phone and its verification state; adds, changes or
 * verifies it with a CHANGE_PHONE SMS code sent to the (new) number.
 */
export function PhoneCard({ phone, verified }: { phone: string | null; verified: boolean }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("view");
  const [newPhone, setNewPhone] = useState("");
  const [target, setTarget] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, startCountdown] = useCountdown();

  useWebOtp(mode === "code", setCode);

  async function sendCode(number: string) {
    setError(null);
    if (!normalizePhone(number)) {
      setError(t("auth.phone.invalid"));
      return;
    }
    setBusy(true);
    try {
      const { res, body } = await postJson("/api/account/otp/request", { purpose: "CHANGE_PHONE", phone: number });
      if (!res.ok) {
        setError(res.status === 409 ? body.error || t("auth.phoneCard.failed") : otpErrorMessage(t, body));
        if (body.retryAfterSec) startCountdown(body.retryAfterSec);
        return;
      }
      setTarget(number);
      setCode("");
      setMode("code");
      startCountdown(body.retryAfterSec ?? 60);
    } catch {
      setError(t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { res, body } = await postJson("/api/account/phone", { phone: target, code });
      if (!res.ok) {
        setError(res.status === 409 ? body.error || t("auth.phoneCard.failed") : otpErrorMessage(t, body));
        return;
      }
      toast.push(phone && normalizePhone(target) !== phone ? t("auth.phoneCard.changed") : t("auth.phoneCard.done"), "success");
      setMode("view");
      setNewPhone("");
      router.refresh();
    } catch {
      setError(t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setMode("view");
    setError(null);
    setCode("");
  }

  return (
    <div className="card flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("auth.phoneCard.title")}</h3>
        {phone && <span className={`text-xs ${verified ? "text-success" : "text-warning"}`}>{verified ? t("auth.verified") : t("auth.notVerified")}</span>}
      </div>
      {phone ? <p className="text-sm font-medium">{formatPhone(phone)}</p> : <p className="text-sm text-muted">{t("auth.phoneCard.none")}</p>}
      <p className="text-xs text-muted">{phone && !verified ? t("auth.phoneCard.unverifiedHint") : t("auth.phoneCard.hint")}</p>
      {error && (
        <div role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {mode === "view" && (
        <div className="flex flex-wrap gap-2">
          {phone && !verified && (
            <button type="button" className="btn-primary !py-1.5 text-xs" onClick={() => void sendCode(phone)} disabled={busy}>
              {busy ? t("auth.phone.sending") : t("auth.phoneCard.verify")}
            </button>
          )}
          <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => setMode("enter")} disabled={busy}>
            {phone ? t("auth.phoneCard.change") : t("auth.phoneCard.add")}
          </button>
        </div>
      )}

      {mode === "enter" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendCode(newPhone);
          }}
          className="flex flex-col gap-2 text-sm"
          noValidate
        >
          <label className="flex flex-col gap-1">
            <span className="font-medium">{t("auth.phoneCard.newNumber")}</span>
            <input type="tel" autoComplete="tel" inputMode="tel" placeholder={t("auth.phone.placeholder")} className="input-base" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} maxLength={32} autoFocus required />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary !py-1.5 text-xs" disabled={busy || !newPhone.trim()}>
              {busy ? t("auth.phone.sending") : t("auth.phone.sendCode")}
            </button>
            <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={cancel} disabled={busy}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}

      {mode === "code" && (
        <form onSubmit={confirm} className="flex flex-col gap-2 text-sm">
          <p className="text-xs text-muted">{t("auth.otp.sentTo", { phone: formatPhone(normalizePhone(target) ?? target), minutes: 5 })}</p>
          <label className="flex flex-col gap-1">
            <span className="font-medium">{t("auth.otp.codeLabel")}</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              className="input-base text-center tracking-[0.4em]"
              value={code}
              onChange={(e) => setCode(sanitizeCode(e.target.value))}
              placeholder="••••••"
              autoFocus
              required
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn-primary !py-1.5 text-xs" disabled={busy || code.length !== 6}>
              {busy ? t("auth.phoneCard.confirming") : t("auth.phoneCard.confirm")}
            </button>
            <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={() => void sendCode(target)} disabled={busy || resendIn > 0}>
              {resendIn > 0 ? t("auth.otp.resendIn", { seconds: resendIn }) : t("auth.otp.resend")}
            </button>
            <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={cancel} disabled={busy}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
