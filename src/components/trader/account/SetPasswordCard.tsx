"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { otpErrorMessage, postJson, sanitizeCode, useCountdown, useWebOtp } from "@/components/shared/otpClient";

/**
 * First password for a phone-only account. Proven by a fresh SMS code to the
 * account's verified phone (`maskedPhone` is null when there is none yet).
 */
export function SetPasswordCard({ maskedPhone }: { maskedPhone: string | null }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, startCountdown] = useCountdown();

  useWebOtp(codeSent, setCode);

  async function sendCode() {
    setError(null);
    setBusy(true);
    try {
      const { res, body } = await postJson("/api/account/otp/request", { purpose: "SET_PASSWORD" });
      if (!res.ok) {
        setError(res.status === 409 ? body.error || t("auth.setPassword.failed") : otpErrorMessage(t, body));
        if (body.retryAfterSec) startCountdown(body.retryAfterSec);
        return;
      }
      setCodeSent(true);
      startCountdown(body.retryAfterSec ?? 60);
    } catch {
      setError(t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("auth.reset.mismatch"));
      return;
    }
    setBusy(true);
    try {
      const { res, body } = await postJson("/api/account/password", { code, newPassword: password });
      if (!res.ok) {
        const issue = body.issues?.[0];
        setError(issue?.path === "newPassword" ? issue.message ?? t("auth.setPassword.failed") : res.status === 409 ? body.error || t("auth.setPassword.failed") : otpErrorMessage(t, body));
        return;
      }
      toast.push(t("auth.setPassword.done"), "success");
      router.refresh();
    } catch {
      setError(t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col gap-3 p-5">
      <div>
        <h3 className="text-sm font-semibold">{t("auth.setPassword.title")}</h3>
        <p className="text-xs text-muted">{t("auth.setPassword.hint")}</p>
      </div>
      {error && (
        <div role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}
      {!maskedPhone ? (
        <p className="text-xs text-warning">{t("auth.setPassword.needsPhone")}</p>
      ) : !codeSent ? (
        <button type="button" className="btn-secondary self-start !py-1.5 text-xs" onClick={() => void sendCode()} disabled={busy || resendIn > 0}>
          {busy ? t("auth.phone.sending") : resendIn > 0 ? t("auth.otp.resendIn", { seconds: resendIn }) : t("auth.setPassword.sendCode", { phone: maskedPhone })}
        </button>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
          <p className="text-xs text-muted">{t("auth.otp.sentTo", { phone: maskedPhone, minutes: 5 })}</p>
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
              required
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">{t("auth.reset.newPassword")}</span>
            <input type="password" autoComplete="new-password" className="input-base" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} maxLength={72} />
            <span className="text-xs text-muted">{t("auth.register.passwordHint")}</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">{t("auth.reset.confirm")}</span>
            <input type="password" autoComplete="new-password" className="input-base" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn-primary !py-1.5 text-xs" disabled={busy || code.length !== 6}>
              {busy ? t("auth.setPassword.saving") : t("auth.setPassword.submit")}
            </button>
            <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={() => void sendCode()} disabled={busy || resendIn > 0}>
              {resendIn > 0 ? t("auth.otp.resendIn", { seconds: resendIn }) : t("auth.otp.resend")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
