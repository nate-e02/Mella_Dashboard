"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/i18n/client";
import { AuthShell, AuthTabs, FormAlert } from "@/components/shared/AuthShell";
import { MfaCodeForm } from "@/components/shared/MfaCodeForm";
import { PhoneAuthFlow } from "@/components/shared/PhoneAuthFlow";

/** Only same-origin relative paths are honoured for post-login redirects. */
function safeNext(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}

function LoginForm() {
  const t = useT();
  const [method, setMethod] = useState<"phone" | "email">("phone");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"password" | "mfa">("password");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  function finish(role: string) {
    const next = safeNext(searchParams.get("next"));
    router.push(next ?? (role === "ADMIN" ? "/admin" : "/dashboard"));
    router.refresh();
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(res.status === 401 ? t("auth.login.invalid") : res.status === 403 ? t("auth.login.disabled") : body.error || t("auth.login.failed"));
        return;
      }
      if (body.mfaRequired) {
        setStep("mfa");
        return;
      }
      finish(body.role);
    } catch {
      setError(t("common.unexpectedError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title={step === "mfa" ? t("auth.mfa.title") : t("auth.login.title")} subtitle={step === "mfa" ? t("auth.mfa.subtitle") : t("auth.login.subtitle")}>
      {step === "mfa" ? (
        <MfaCodeForm
          onSuccess={finish}
          onBack={(reason) => {
            setStep("password");
            setError(reason ?? null);
          }}
        />
      ) : (
        <>
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
            <PhoneAuthFlow onAuthenticated={(role) => finish(role)} />
          ) : (
            <form onSubmit={submitPassword} className="flex flex-col gap-3">
              {error && <FormAlert>{error}</FormAlert>}
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{t("auth.login.identifier")}</span>
                <input type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} className="input-base" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">{t("auth.login.password")}</span>
                <input type="password" autoComplete="current-password" className="input-base" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              <button type="submit" className="btn-primary mt-2" disabled={loading}>
                {loading ? t("auth.login.submitting") : t("auth.login.submit")}
              </button>
              <Link href="/forgot-password" className="text-center text-xs text-muted hover:text-foreground">
                {t("auth.login.forgot")}
              </Link>
            </form>
          )}
        </>
      )}
      <p className="mt-4 text-center text-xs text-muted">
        {t("auth.login.noAccount")}{" "}
        <Link href="/register" className="text-accent-2 underline">
          {t("auth.login.register")}
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

function Fallback() {
  const t = useT();
  return <div className="flex min-h-screen items-center justify-center text-sm text-muted">{t("common.loading")}</div>;
}

export default function LoginPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <LoginForm />
    </Suspense>
  );
}
