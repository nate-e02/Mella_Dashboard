"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";

/**
 * TOTP enrolment / disable UI shared by traders and admins. Enrolment is a
 * two-step flow: fetch a QR code, then confirm with a live code; backup codes
 * are shown exactly once.
 */
export function MfaSettings({ enabled, required }: { enabled: boolean; required: boolean }) {
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
      if (!res.ok) throw new Error(body.error || "Could not start MFA setup");
      setEnrolment(body);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Could not start MFA setup", "error");
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
      if (!res.ok) throw new Error(body.error || "Invalid code");
      setBackupCodes(body.backupCodes);
      setEnrolment(null);
      setCode("");
      toast.push("Two-factor authentication enabled", "success");
      router.refresh();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Invalid code", "error");
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
      if (!res.ok) throw new Error(body.error || "Could not disable MFA");
      toast.push("Two-factor authentication disabled", "success");
      setCode("");
      setDisablePassword("");
      router.refresh();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Could not disable MFA", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex max-w-md flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Two-factor authentication</h3>
        <span className={`text-xs ${enabled ? "text-success" : "text-warning"}`}>{enabled ? "Enabled" : "Not enabled"}</span>
      </div>
      {required && !enabled && (
        <div role="alert" className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          Admin access requires two-factor authentication. Set it up now to continue.
        </div>
      )}

      {backupCodes && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-xs">
          <p className="mb-2 font-medium text-success">Save these backup codes now. Each works once and they will not be shown again.</p>
          <div className="grid grid-cols-2 gap-1 font-mono">
            {backupCodes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <button className="btn-secondary mt-3 !py-1 text-xs" onClick={() => setBackupCodes(null)}>
            I have saved them
          </button>
        </div>
      )}

      {!enabled && !enrolment && (
        <button className="btn-primary self-start" onClick={start} disabled={busy}>
          {busy ? "Preparing..." : "Set up authenticator app"}
        </button>
      )}

      {!enabled && enrolment && (
        <form onSubmit={confirm} className="flex flex-col gap-3">
          <p className="text-xs text-muted">Scan this QR code with Google Authenticator, Authy or any TOTP app, then enter the 6-digit code.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrolment.qrDataUrl} alt="Authenticator QR code" width={200} height={200} className="rounded-lg bg-white p-2 self-start" />
          <p className="break-all font-mono text-xs text-muted">Manual key: {enrolment.secretBase32}</p>
          <input inputMode="numeric" autoComplete="one-time-code" className="input-base" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} required />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Verifying..." : "Confirm and enable"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setEnrolment(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {enabled && !required && (
        <form onSubmit={disable} className="flex flex-col gap-2">
          <p className="text-xs text-muted">To disable, confirm your password and a current code.</p>
          <input type="password" autoComplete="current-password" className="input-base" placeholder="Password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} required />
          <input inputMode="numeric" className="input-base" placeholder="Authenticator code" value={code} onChange={(e) => setCode(e.target.value)} required />
          <button type="submit" className="btn-danger self-start" disabled={busy}>
            Disable two-factor
          </button>
        </form>
      )}
      {enabled && required && <p className="text-xs text-muted">Two-factor authentication is mandatory for admin accounts and cannot be disabled here.</p>}
    </div>
  );
}
