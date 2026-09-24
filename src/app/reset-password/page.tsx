"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function ResetForm() {
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
      setError("Passwords do not match");
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
        setError(body.error || body.issues?.[0]?.message || "Could not reset password");
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/login"), 1500);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return <p className="text-sm text-danger">This reset link is missing its token. Request a new one.</p>;
  }

  return done ? (
    <div className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">Password updated. Redirecting to login…</div>
  ) : (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {error && (
        <div role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">New password</span>
        <input type="password" autoComplete="new-password" className="input-base" value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} required />
        <span className="text-xs text-muted">At least 12 characters.</span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Confirm password</span>
        <input type="password" autoComplete="new-password" className="input-base" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </label>
      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? "Saving..." : "Set new password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="mb-4 text-xl font-semibold">Choose a new password</h1>
        <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
          <ResetForm />
        </Suspense>
        <p className="mt-4 text-center text-xs text-muted">
          <Link href="/login" className="hover:text-foreground">
            ← Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
