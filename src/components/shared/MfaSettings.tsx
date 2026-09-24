"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";

/**
 * TOTP enrolment / disable UI shared by traders and admins. Enrolment is a
 * two-step flow: fetch a QR code, then confirm with a live code; backup codes
 * are shown exactly once. Disabling needs the password, so a phone-only
 * account (`hasPassword` false) is pointed at "Set a password" first.
 */
export function MfaSettings({ enabled, required, hasPassword = true }: { enabled: boolean; required: boolean; hasPassword?: boolean }) {
  const t = useT();
  const [enrolment, setEnrolment] = useState<{ qrDataUrl: string; secretBase32: string } | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();

  async function start() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/mfa/setup", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t("auth.mfaSettings.startFailed"));
      setEnrolment(body);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("auth.mfaSettings.startFailed"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/auth/mfa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t("auth.mfa.invalid"));
      setBackupCodes(body.backupCodes);
      setEnrolment(null);
      setCode("");
      toast.push(t("auth.mfaSettings.enabledToast"), "success");
      router.refresh();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("auth.mfa.invalid"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/auth/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePassword, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t("auth.mfaSettings.disableFailed"));
      toast.push(t("auth.mfaSettings.disabledToast"), "success");
      setCode("");
      setDisablePassword("");
      router.refresh();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("auth.mfaSettings.disableFailed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex max-w-md flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("auth.mfaSettings.title")}</h3>
        <span className={`text-xs ${enabled ? "text-success" : "text-warning"}`}>{enabled ? t("auth.mfaSettings.enabled") : t("auth.mfaSettings.notEnabled")}</span>
      </div>
      {required && !enabled && (
        <div role="alert" className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          {t("auth.mfaSettings.adminRequired")}
        </div>
      )}

      {backupCodes && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-xs">
          <p className="mb-2 font-medium text-success">{t("auth.mfaSettings.saveBackup")}</p>
          <div className="grid grid-cols-2 gap-1 font-mono">
            {backupCodes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <button className="btn-secondary mt-3 !py-1 text-xs" onClick={() => setBackupCodes(null)}>
            {t("auth.mfaSettings.savedBackup")}
          </button>
        </div>
      )}

      {!enabled && !enrolment && (
        <button className="btn-primary self-start" onClick={start} disabled={busy}>
          {busy ? t("auth.mfaSettings.preparing") : t("auth.mfaSettings.setup")}
        </button>
      )}

      {!enabled && enrolment && (
        <form onSubmit={confirm} className="flex flex-col gap-3">
          <p className="text-xs text-muted">{t("auth.mfaSettings.scan")}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrolment.qrDataUrl} alt={t("auth.mfaSettings.qrAlt")} width={200} height={200} className="rounded-lg bg-white p-2 self-start" />
          <p className="break-all font-mono text-xs text-muted">{t("auth.mfaSettings.manualKey", { key: enrolment.secretBase32 })}</p>
          <input inputMode="numeric" autoComplete="one-time-code" className="input-base" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? t("auth.mfa.verifying") : t("auth.mfaSettings.confirm")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setEnrolment(null)} disabled={busy}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      )}

      {enabled && !required && hasPassword && (
        <form onSubmit={disable} className="flex flex-col gap-2">
          <p className="text-xs text-muted">{t("auth.mfaSettings.disableHint")}</p>
          <input type="password" autoComplete="current-password" className="input-base" placeholder={t("auth.mfaSettings.password")} value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} required />
          <input inputMode="numeric" autoComplete="one-time-code" className="input-base" placeholder={t("auth.mfaSettings.code")} value={code} onChange={(e) => setCode(e.target.value)} required />
          <button type="submit" className="btn-danger self-start" disabled={busy}>
            {t("auth.mfaSettings.disable")}
          </button>
        </form>
      )}
      {enabled && !required && !hasPassword && <p className="text-xs text-muted">{t("auth.mfaSettings.needsPassword")}</p>}
      {enabled && required && <p className="text-xs text-muted">{t("auth.mfaSettings.mandatory")}</p>}
    </div>
  );
}
