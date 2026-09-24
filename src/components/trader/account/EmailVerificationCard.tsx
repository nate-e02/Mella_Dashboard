"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";

export function EmailVerificationCard({ email, verified }: { email: string; verified: boolean }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function resend() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/verify-email/resend", { method: "POST" });
      if (!res.ok) throw new Error();
      toast.push("Verification email sent. Check your inbox (and spam folder).", "success");
    } catch {
      toast.push("Could not send the verification email. Try again later.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Email verification</h3>
        <span className={`text-xs ${verified ? "text-success" : "text-warning"}`}>{verified ? "Verified" : "Not verified"}</span>
      </div>
      <p className="text-sm text-muted">{email}</p>
      {!verified && (
        <>
          <p className="mt-2 text-xs text-muted">Verify your email to purchase challenges and receive payout notices.</p>
          <button className="btn-secondary mt-3 !py-1.5 text-xs" onClick={resend} disabled={busy}>
            {busy ? "Sending..." : "Resend verification email"}
          </button>
        </>
      )}
    </div>
  );
}
