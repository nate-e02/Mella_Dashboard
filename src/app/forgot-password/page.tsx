"use client";

import { useState } from "react";
import Link from "next/link";
import { useT } from "@/i18n/client";
import { AuthShell, FormAlert } from "@/components/shared/AuthShell";

export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } finally {
      setSent(true);
      setLoading(false);
    }
  }

  return (
    <AuthShell title={t("auth.forgot.title")} subtitle={t("auth.forgot.subtitle")}>
      {sent ? (
        <FormAlert tone="success">{t("auth.forgot.sent")}</FormAlert>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t("auth.forgot.email")}</span>
            <input type="email" autoComplete="email" className="input-base" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? t("auth.forgot.sending") : t("auth.forgot.submit")}
          </button>
        </form>
      )}
      <p className="mt-4 text-center text-xs text-muted">
        <Link href="/login" className="hover:text-foreground">
          {t("auth.forgot.phoneHint")}
        </Link>
      </p>
      <p className="mt-2 text-center text-xs text-muted">
        <Link href="/login" className="hover:text-foreground">
          {t("auth.backToLogin")}
        </Link>
      </p>
    </AuthShell>
  );
}
