"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { FormAlert } from "@/components/shared/AuthShell";
import { MfaCodeForm } from "@/components/shared/MfaCodeForm";
import { otpErrorMessage, postJson, sanitizeCode, useCountdown, useWebOtp } from "@/components/shared/otpClient";

type Step = "phone" | "code" | "profile" | "mfa" | "welcome";

const OTP_MINUTES = 5;

/**
 * Phone login and sign-up in one flow (used by /login and /register):
 * number → SMS code → (new number: name + optional email) → (MFA if enabled).
 * The server decides whether the number is new; the UI never asks.
 */
export function PhoneAuthFlow({ onAuthenticated }: { onAuthenticated: (role: string, next?: string) => void }) {
  const t = useT();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("TRADER");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendIn, startCountdown] = useCountdown();

  useWebOtp(step === "code", setCode);

  function restart(message: string | null) {
    setStep("phone");
    setCode("");
    setNotice(null);
    setError(message);
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    setNotice(null);
    if (!normalizePhone(phone)) {
      setError(t("auth.phone.invalid"));
      return;
    }
    setLoading(true);
    try {
      const { res, body } = await postJson("/api/auth/otp/request", { phone });
      if (!res.ok) {
        setError(otpErrorMessage(t, body));
        if (body.retryAfterSec) startCountdown(body.retryAfterSec);
        // A code went to this number moments ago: let them type it instead of waiting.
        if (body.code === "COOLDOWN" && step === "phone") {
          setSentTo(formatPhone(normalizePhone(phone) ?? phone));
          setStep("code");
        }
        return;
      }
      if (step === "code") setNotice(t("auth.otp.resent"));
      setSentTo(String(body.phone ?? phone));
      setCode("");
      setStep("code");
      startCountdown(body.retryAfterSec ?? 60);
    } catch {
      setError(t("common.unexpectedError"));
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const { res, body } = await postJson("/api/auth/otp/verify", { phone, code });
      if (!res.ok) {
        setError(res.status === 403 ? t("auth.login.disabled") : res.status === 401 ? t("auth.otp.invalid") : otpErrorMessage(t, body));
        return;
      }
      if (body.mfaRequired) setStep("mfa");
      else if (body.needsProfile) setStep("profile");
      else onAuthenticated(String(body.role ?? ""));
    } catch {
      setError(t("common.unexpectedError"));
    } finally {
      setLoading(false);
    }
  }

  async function completeProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { res, body } = await postJson("/api/auth/otp/complete", { name, email: email.trim() || undefined });
      if (!res.ok) {
        if (body.code === "PHONE_PROOF_EXPIRED") restart(t("auth.profile.expired"));
        else if (body.code === "PHONE_TAKEN") restart(t("auth.profile.phoneTaken"));
        else setError(body.issues?.[0]?.message || body.error || t("common.unexpectedError"));
        return;
      }
      if (email.trim() && !body.emailAttached) {
        setRole(String(body.role ?? "TRADER"));
        setStep("welcome");
        return;
      }
      onAuthenticated(String(body.role ?? "TRADER"), typeof body.next === "string" ? body.next : undefined);
    } catch {
      setError(t("common.unexpectedError"));
    } finally {
      setLoading(false);
    }
  }

  if (step === "mfa") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-center text-sm text-muted">{t("auth.mfa.subtitle")}</p>
        <MfaCodeForm onSuccess={(r) => onAuthenticated(r)} onBack={(reason) => restart(reason ?? null)} />
      </div>
    );
  }

  if (step === "welcome") {
    return (
      <div className="flex flex-col gap-3">
        <FormAlert tone="info">{t("auth.profile.emailNotAdded")}</FormAlert>
        <button type="button" className="btn-primary" onClick={() => onAuthenticated(role, "/dashboard")}>
          {t("common.continue")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <FormAlert>{error}</FormAlert>}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {step === "phone" && (
        <form onSubmit={sendCode} className="flex flex-col gap-3" noValidate>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t("auth.phone.label")}</span>
            <input
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder={t("auth.phone.placeholder")}
              className="input-base"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={32}
              autoFocus
              required
            />
            <span className="text-xs text-muted">{t("auth.phone.hint")}</span>
          </label>
          <button type="submit" className="btn-primary mt-1" disabled={loading || !phone.trim()}>
            {loading ? t("auth.phone.sending") : t("auth.phone.sendCode")}
          </button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verifyCode} className="flex flex-col gap-3">
          <p className="text-sm text-muted">{t("auth.otp.sentTo", { phone: sentTo, minutes: OTP_MINUTES })}</p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t("auth.otp.codeLabel")}</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              className="input-base text-center text-lg tracking-[0.4em]"
              value={code}
              onChange={(e) => setCode(sanitizeCode(e.target.value))}
              placeholder="••••••"
              autoFocus
              required
            />
          </label>
          <button type="submit" className="btn-primary" disabled={loading || code.length !== 6}>
            {loading ? t("auth.otp.verifying") : t("auth.otp.verify")}
          </button>
          <div className="flex items-center justify-between gap-2 text-xs">
            <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => restart(null)} disabled={loading}>
              {t("auth.otp.changeNumber")}
            </button>
            <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void sendCode()} disabled={loading || resendIn > 0}>
              {resendIn > 0 ? t("auth.otp.resendIn", { seconds: resendIn }) : t("auth.otp.resend")}
            </button>
          </div>
        </form>
      )}

      {step === "profile" && (
        <form onSubmit={completeProfile} className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold">{t("auth.profile.title")}</h2>
            <p className="text-sm text-muted">{t("auth.profile.subtitle", { phone: sentTo })}</p>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t("auth.profile.name")}</span>
            <input className="input-base" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={100} autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t("auth.profile.email")}</span>
            <input type="email" autoComplete="email" className="input-base" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
            <span className="text-xs text-muted">{t("auth.profile.emailHint")}</span>
          </label>
          <button type="submit" className="btn-primary mt-1" disabled={loading}>
            {loading ? t("auth.profile.submitting") : t("auth.profile.submit")}
          </button>
        </form>
      )}
    </div>
  );
}
