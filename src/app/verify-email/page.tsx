"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function VerifyEmail() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"verifying" | "ok" | "error">("verifying");
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !token) return;
    started.current = true;
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => setState(res.ok ? "ok" : "error"))
      .catch(() => setState("error"));
  }, [token]);

  if (!token) return <p className="text-sm text-danger">This verification link is missing its token.</p>;
  if (state === "verifying") return <p className="text-sm text-muted">Verifying your email…</p>;
  if (state === "ok")
    return (
      <div className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
        Your email is verified. You can now purchase challenges.{" "}
        <Link href="/dashboard" className="underline">
          Go to your dashboard
        </Link>
        .
      </div>
    );
  return (
    <div className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
      This link is invalid or has expired. Log in and request a new verification email from your Account page.
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="mb-3 text-xl font-semibold">Email verification</h1>
        <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
          <VerifyEmail />
        </Suspense>
      </div>
    </div>
  );
}
