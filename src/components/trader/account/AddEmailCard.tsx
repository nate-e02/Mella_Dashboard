"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";
import { postJson } from "@/components/shared/otpClient";

/** For phone sign-ups without an email. The answer never reveals whether the address belongs to someone else. */
export function AddEmailCard() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { res, body } = await postJson("/api/account/email", { email });
      if (!res.ok) throw new Error(body.issues?.[0]?.message || body.error || t("auth.addEmail.failed"));
      toast.push(t("auth.addEmail.done", { email: email.trim() }), "success");
      setEmail("");
      router.refresh();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("auth.addEmail.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card flex flex-col gap-3 p-5">
      <div>
        <h3 className="text-sm font-semibold">{t("auth.addEmail.title")}</h3>
        <p className="text-xs text-muted">{t("auth.addEmail.hint")}</p>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("auth.addEmail.label")}</span>
        <input type="email" autoComplete="email" className="input-base" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} />
      </label>
      <button type="submit" className="btn-secondary self-start !py-1.5 text-xs" disabled={busy}>
        {busy ? t("auth.addEmail.saving") : t("auth.addEmail.submit")}
      </button>
    </form>
  );
}
