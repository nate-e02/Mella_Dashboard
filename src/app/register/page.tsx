"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { AuthShell, AuthTabs, FormAlert } from "@/components/shared/AuthShell";
import { PhoneAuthFlow } from "@/components/shared/PhoneAuthFlow";

export default function RegisterPage() {
  const t = useT();
  const [method, setMethod] = useState<"phone" | "email">("phone");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function finish(role: string, next?: string) {
    router.push(next ?? (role === "ADMIN" ? "/admin" : "/dashboard"));
    router.refresh();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.issues?.[0]?.message || body.error || t("auth.register.failed"));
        return;
      }
      router.push(body.next ?? "/dashboard");
      router.refresh();
    } catch {
      setError(t("common.unexpectedError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title={t("auth.register.title")} subtitle={t("auth.register.subtitle")}>
      <AuthTabs
        label={t("auth.tabs.label")}
        value={method}
        onChange={(m) => {
          setMethod(m);
          setError(null);
        }}
        options={[
          { value: "phone", label: t("auth.tabs.phone") },
          { value: "email", label: t("auth.tabs.email") },
        ]}
      />
      {method === "phone" ? (
        <PhoneAuthFlow onAuthenticated={finish} />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          {error && <FormAlert>{error}</FormAlert>}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t("auth.register.name")}</span>
            <input className="input-base" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t("auth.register.email")}</span>
            <input type="email" autoComplete="email" className="input-base" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t("auth.register.password")}</span>
            <input type="password" autoComplete="new-password" className="input-base" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} maxLength={72} />
            <span className="text-xs text-muted">{t("auth.register.passwordHint")}</span>
          </label>
          <button type="submit" className="btn-primary mt-2" disabled={loading}>
            {loading ? t("auth.register.submitting") : t("auth.register.submit")}
          </button>
        </form>
      )}
      <p className="mt-4 text-center text-xs text-muted">
        {t("auth.register.haveAccount")}{" "}
        <Link href="/login" className="text-accent-2 underline">
          {t("auth.register.login")}
        </Link>
      </p>
      <p className="mt-2 text-center text-xs text-muted">
        <Link href="/" className="hover:text-foreground">
          {t("common.backHome")}
        </Link>
      </p>
    </AuthShell>
  );
}
