"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";
import { FormAlert } from "@/components/shared/AuthShell";
import { postJson } from "@/components/shared/otpClient";

/**
 * Second login step after a password or SMS code for an account with TOTP:
 * exchanges the pending MFA challenge cookie plus a code for a session.
 */
export function MfaCodeForm({ onSuccess, onBack }: { onSuccess: (role: string) => void; onBack: (reason?: string) => void }) {
  const t = useT();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { res, body } = await postJson("/api/auth/mfa/verify", { code });
      if (!res.ok) {
        if (res.status === 401 && /log ?in again/i.test(body.error ?? "")) {
          // The 5-minute challenge lapsed: start the login again, with the reason shown there.
          onBack(t("auth.mfa.expired"));
          return;
        }
        setError(t("auth.mfa.invalid"));
        return;
      }
      onSuccess(String(body.role ?? ""));
    } catch {
      setError(t("common.unexpectedError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {error && <FormAlert>{error}</FormAlert>}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("auth.mfa.codeLabel")}</span>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          className="input-base text-center text-lg tracking-widest"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123 456"
          autoFocus
          required
        />
      </label>
      <p className="text-xs text-muted">{t("auth.mfa.backupHint")}</p>
      <button type="submit" className="btn-primary mt-2" disabled={loading}>
        {loading ? t("auth.mfa.verifying") : t("auth.mfa.verify")}
      </button>
      <button type="button" className="btn-ghost text-xs" onClick={() => onBack()}>
        {t("common.back")}
      </button>
    </form>
  );
}
