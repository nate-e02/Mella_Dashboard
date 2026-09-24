"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { useT } from "@/i18n/client";

/** Client helpers shared by the phone login flow and the account-page SMS code forms. */

type T = ReturnType<typeof useT>;
export type ApiBody = {
  error?: string;
  code?: string;
  retryAfterSec?: number;
  issues?: { path?: string; message?: string }[];
  [key: string]: unknown;
};

export async function postJson(url: string, payload: unknown): Promise<{ res: Response; body: ApiBody }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = (await res.json().catch(() => ({}))) as ApiBody;
  return { res, body };
}

/** Digits only, at most 6 (pasted "123 456" or "Code: 123456" both work). */
export function sanitizeCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}

/** Translated message for an error from a send-code / check-code endpoint; falls back to the server's English text. */
export function otpErrorMessage(t: T, body: ApiBody): string {
  switch (body.code) {
    case "INVALID_PHONE":
      return t("auth.phone.invalid");
    case "COOLDOWN":
      return t("auth.otp.cooldown", { seconds: body.retryAfterSec ?? 60 });
    case "HOURLY_LIMIT":
      return t("auth.otp.hourlyLimit", { minutes: Math.max(1, Math.ceil((body.retryAfterSec ?? 3600) / 60)) });
    case "UNAVAILABLE":
      return t("auth.otp.unavailable");
    case "SEND_FAILED":
      return t("auth.otp.sendFailed");
    case "INVALID_CODE":
      return t("auth.otp.invalid");
  }
  const issue = body.issues?.[0];
  if (issue?.path === "phone") return t("auth.phone.invalid");
  if (issue?.path === "code") return t("auth.otp.invalid");
  return body.error || issue?.message || t("common.unexpectedError");
}

/** Seconds left before "resend" is allowed; `start(n)` (re)starts the countdown. */
export function useCountdown(): [number, (seconds: number) => void] {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (until === 0) return;
    const id = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  }, [until]);

  const start = useCallback((seconds: number) => {
    const current = Date.now();
    setNow(current);
    setUntil(current + seconds * 1000);
  }, []);

  return [Math.max(0, Math.ceil((until - now) / 1000)), start];
}

/**
 * WebOTP: on Android Chrome the browser offers to fill the code from the SMS
 * (whose last line is `@<our host> #<code>`). A no-op elsewhere; the input's
 * autocomplete="one-time-code" covers iOS.
 */
export function useWebOtp(active: boolean, onCode: (code: string) => void) {
  const callback = useRef(onCode);
  useEffect(() => {
    callback.current = onCode;
  });

  useEffect(() => {
    if (!active || typeof window === "undefined" || !("OTPCredential" in window)) return;
    const controller = new AbortController();
    navigator.credentials
      .get({ otp: { transport: ["sms"] }, signal: controller.signal } as CredentialRequestOptions)
      .then((credential) => {
        const code = (credential as { code?: string } | null)?.code;
        if (code) callback.current(sanitizeCode(code));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [active]);
}
