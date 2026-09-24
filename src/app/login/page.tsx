"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

/** Only same-origin relative paths are honoured for post-login redirects. */
function safeNext(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
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
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Login failed");
        return;
      }
      if (body.mfaRequired) {
        setStep("mfa");
        return;
      }
      finish(body.role);
    } catch {
      setError("Unexpected error, please try again");
    } finally {
      setLoading(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Invalid code");
        if (res.status === 401 && /log in again/i.test(body.error ?? "")) setStep("password");
        return;
      }
      finish(body.role);
    } catch {
      setError("Unexpected error, please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-accent-2 to-accent text-base font-bold text-white">
            M
          </div>
          <h1 className="text-xl font-semibold">{step === "mfa" ? "Two-factor code" : "Welcome back"}</h1>
          <p className="text-sm text-muted">{step === "mfa" ? "Enter the 6-digit code from your authenticator app" : "Log in to MellaFx"}</p>
        </div>
        {error && (
          <div role="alert" className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}
        {step === "password" ? (
          <form onSubmit={submitPassword} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Email</span>
              <input type="email" autoComplete="email" className="input-base" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Password</span>
              <input type="password" autoComplete="current-password" className="input-base" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <button type="submit" className="btn-primary mt-2" disabled={loading}>
              {loading ? "Logging in..." : "Log In"}
            </button>
            <Link href="/forgot-password" className="text-center text-xs text-muted hover:text-foreground">
              Forgot your password?
            </Link>
          </form>
        ) : (
          <form onSubmit={submitCode} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Authentication code</span>
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
            <p className="text-xs text-muted">Lost your device? Enter one of your backup codes instead.</p>
            <button type="submit" className="btn-primary mt-2" disabled={loading}>
              {loading ? "Verifying..." : "Verify"}
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={() => setStep("password")}>
              Back
            </button>
          </form>
        )}
        <p className="mt-4 text-center text-xs text-muted">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-accent-2 underline">
            Register
          </Link>
        </p>
        <p className="mt-2 text-center text-xs text-muted">
          <Link href="/" className="hover:text-foreground">
            ← Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-muted">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
