import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { sendSms, smsConfigured } from "@/lib/notify/sms";
import { tFor } from "@/i18n/server";
import { appUrl, isProduction } from "@/env";

/**
 * SMS one-time codes (login / sign-up, confirming a new phone number, setting
 * a first password). Codes are keyed by phone, not user, because the person
 * may not have an account yet. Only an HMAC of `purpose:phone:code` is stored,
 * so a database leak does not reveal live codes and a code can never be
 * replayed for another number or purpose. All throttling is database-backed
 * (and serialised per phone with an advisory lock), so it holds across
 * replicas; the per-IP limits live in src/proxy.ts.
 */

export const OTP_PURPOSES = ["LOGIN", "CHANGE_PHONE", "SET_PASSWORD"] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

export const OTP_TTL_SEC = 5 * 60;
export const OTP_RESEND_COOLDOWN_SEC = 60;
export const OTP_MAX_PER_HOUR = 5;
export const OTP_MAX_ATTEMPTS = 5;

function secret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET is not configured");
  return value;
}

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(purpose: OtpPurpose, phone: string, code: string): string {
  return createHmac("sha256", secret()).update(`${purpose}:${phone}:${code}`).digest("hex");
}

/** Constant-time comparison of a submitted code against a stored hash. */
export function otpMatches(storedHash: string, purpose: OtpPurpose, phone: string, code: string): boolean {
  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(hashOtp(purpose, phone, code), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Text of the SMS, ending with the WebOTP / Android autofill line (`@host #code`). */
export function otpMessage(locale: string | null | undefined, purpose: OtpPurpose, code: string): string {
  const t = tFor(locale);
  const minutes = Math.round(OTP_TTL_SEC / 60);
  const body = purpose === "LOGIN" ? t("auth.sms.loginCode", { code, minutes }) : t("auth.sms.securityCode", { code, minutes });
  return `${body}\n\n@${new URL(appUrl()).hostname} #${code}`;
}

export type RequestOtpResult =
  | { ok: true; phone: string; expiresInSec: number; retryAfterSec: number }
  | { ok: false; reason: "INVALID_PHONE" | "UNAVAILABLE" | "SEND_FAILED" }
  | { ok: false; reason: "COOLDOWN" | "HOURLY_LIMIT"; retryAfterSec: number };

/**
 * Issues a new code for `phone` + `purpose` and sends it by SMS. The outcome
 * never depends on whether the number belongs to an account (no
 * enumeration); only the throttling state of the number the caller typed is
 * revealed. A new code invalidates any earlier unused code for the same
 * number and purpose.
 */
export async function requestPhoneOtp(input: { phone: string; ip?: string | null; locale?: string | null; purpose: OtpPurpose }): Promise<RequestOtpResult> {
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, reason: "INVALID_PHONE" };
  // Fail closed: in production a code that cannot be delivered must not be logged instead.
  if (isProduction() && !smsConfigured()) return { ok: false, reason: "UNAVAILABLE" };

  const code = generateOtpCode();
  const now = Date.now();
  const issued = await prisma.$transaction(async (tx) => {
    // Serialises concurrent requests for the same number across replicas.
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${`phone-otp:${phone}`}))`;

    const recent = await tx.phoneOtp.findMany({
      where: { phone, createdAt: { gt: new Date(now - 60 * 60_000) } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    const last = recent[recent.length - 1];
    if (last && now - last.createdAt.getTime() < OTP_RESEND_COOLDOWN_SEC * 1000) {
      return { ok: false as const, reason: "COOLDOWN" as const, retryAfterSec: Math.ceil((last.createdAt.getTime() + OTP_RESEND_COOLDOWN_SEC * 1000 - now) / 1000) };
    }
    if (recent.length >= OTP_MAX_PER_HOUR) {
      const oldest = recent[recent.length - OTP_MAX_PER_HOUR];
      return { ok: false as const, reason: "HOURLY_LIMIT" as const, retryAfterSec: Math.max(1, Math.ceil((oldest.createdAt.getTime() + 60 * 60_000 - now) / 1000)) };
    }

    await tx.phoneOtp.updateMany({ where: { phone, purpose: input.purpose, consumedAt: null }, data: { consumedAt: new Date(now) } });
    const row = await tx.phoneOtp.create({
      data: { phone, purpose: input.purpose, codeHash: hashOtp(input.purpose, phone, code), expiresAt: new Date(now + OTP_TTL_SEC * 1000), ip: input.ip ?? null },
      select: { id: true },
    });
    return { ok: true as const, id: row.id };
  });
  if (!issued.ok) return issued;

  // An existing account's saved language wins over the browser's.
  const owner = await prisma.user.findUnique({ where: { phone }, select: { locale: true } });
  const sent = await sendSms({ to: phone, message: otpMessage(owner?.locale ?? input.locale, input.purpose, code) });
  if (!sent.delivered && sent.provider !== "console") {
    // Nothing reached the phone: drop the row so the cooldown and hourly cap are not burned.
    await prisma.phoneOtp.delete({ where: { id: issued.id } }).catch(() => undefined);
    return { ok: false, reason: "SEND_FAILED" };
  }
  return { ok: true, phone, expiresInSec: OTP_TTL_SEC, retryAfterSec: OTP_RESEND_COOLDOWN_SEC };
}

/**
 * Checks a code. Only the newest live code for the number and purpose is
 * considered; every check spends one of its 5 attempts (atomically, so
 * parallel guesses cannot exceed the budget), and a correct code is consumed
 * exactly once.
 */
export async function verifyPhoneOtp(input: { phone: string; code: string; purpose: OtpPurpose }): Promise<{ ok: true; phone: string } | { ok: false }> {
  const phone = normalizePhone(input.phone);
  const code = input.code.replace(/\s/g, "");
  if (!phone || !/^\d{6}$/.test(code)) return { ok: false };

  const now = new Date();
  const otp = await prisma.phoneOtp.findFirst({
    where: { phone, purpose: input.purpose, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: OTP_MAX_ATTEMPTS } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) return { ok: false };

  const spent = await prisma.phoneOtp.updateMany({
    where: { id: otp.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (spent.count === 0 || !otpMatches(otp.codeHash, input.purpose, phone, code)) return { ok: false };

  const claim = await prisma.phoneOtp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (claim.count === 0) return { ok: false };
  return { ok: true, phone };
}
