"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/i18n/client";
import { AuthShell, FormAlert } from "@/components/shared/AuthShell";

function ResetForm() {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("auth.reset.mismatch"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || body.issues?.[0]?.message || t("auth.reset.failed"));
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/login"), 1500);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return <p className="text-sm text-danger">{t("auth.reset.missingToken")}</p>;
  }

  return done ? (
    <FormAlert tone="success">{t("auth.reset.done")}</FormAlert>
  ) : (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {error && <FormAlert>{error}</FormAlert>}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("auth.reset.newPassword")}</span>
        <input type="password" autoComplete="new-password" className="input-base" value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} required />
        <span className="text-xs text-muted">{t("auth.reset.hint")}</span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("auth.reset.confirm")}</span>
        <input type="password" autoComplete="new-password" className="input-base" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </label>
      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? t("common.saving") : t("auth.reset.submit")}
      </button>
    </form>
  );
}

function Loading() {
  const t = useT();
  return <div className="text-sm text-muted">{t("common.loading")}</div>;
}

export default function ResetPasswordPage() {
  const t = useT();
  return (
    <AuthShell title={t("auth.reset.title")}>
      <Suspense fallback={<Loading />}>
        <ResetForm />
      </Suspense>
      <p className="mt-4 text-center text-xs text-muted">
        <Link href="/login" className="hover:text-foreground">
          {t("auth.backToLogin")}
        </Link>
      </p>
    </AuthShell>
  );
}
