"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";

export function EmailVerificationCard({ email, verified }: { email: string; verified: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function resend() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/verify-email/resend", { method: "POST" });
      if (!res.ok) throw new Error();
      toast.push(t("auth.emailCard.sent"), "success");
    } catch {
      toast.push(t("auth.emailCard.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("auth.emailCard.title")}</h3>
        <span className={`text-xs ${verified ? "text-success" : "text-warning"}`}>{verified ? t("auth.verified") : t("auth.notVerified")}</span>
      </div>
      <p className="break-all text-sm text-muted">{email}</p>
      {!verified && (
        <>
          <p className="mt-2 text-xs text-muted">{t("auth.emailCard.hint")}</p>
          <button className="btn-secondary mt-3 !py-1.5 text-xs" onClick={resend} disabled={busy}>
            {busy ? t("auth.emailCard.sending") : t("auth.emailCard.resend")}
          </button>
        </>
      )}
    </div>
  );
}
