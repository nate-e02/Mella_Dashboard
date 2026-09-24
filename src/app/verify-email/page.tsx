"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useT } from "@/i18n/client";
import { AuthShell, FormAlert } from "@/components/shared/AuthShell";

function VerifyEmail() {
  const t = useT();
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

  if (!token) return <p className="text-sm text-danger">{t("auth.verifyEmail.missingToken")}</p>;
  if (state === "verifying") return <p className="text-sm text-muted">{t("auth.verifyEmail.verifying")}</p>;
  if (state === "ok")
    return (
      <FormAlert tone="success">
        {t("auth.verifyEmail.ok")}{" "}
        <Link href="/dashboard" className="underline">
          {t("auth.verifyEmail.goDashboard")}
        </Link>
      </FormAlert>
    );
  return <FormAlert>{t("auth.verifyEmail.error")}</FormAlert>;
}

function Loading() {
  const t = useT();
  return <div className="text-sm text-muted">{t("common.loading")}</div>;
}

export default function VerifyEmailPage() {
  const t = useT();
  return (
    <AuthShell title={t("auth.verifyEmail.title")}>
      <Suspense fallback={<Loading />}>
        <VerifyEmail />
      </Suspense>
    </AuthShell>
  );
}
