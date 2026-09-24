import "server-only";
import { Prisma, type User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import {
  clearPhoneSignupProof,
  createMfaChallenge,
  createPhoneSignupProof,
  createSession,
  readPhoneSignupProof,
  revokeAllSessionsForUser,
} from "@/lib/auth/session";
import { AuthError, ConflictError } from "@/lib/errors";
import { logAudit } from "@/lib/services/audit";
import { sendEmailVerification, type LoginOutcome } from "@/lib/services/auth";
import { requestPhoneOtp, verifyPhoneOtp, type RequestOtpResult } from "@/lib/services/phoneOtp";
import { attachReferral } from "@/lib/services/referrals";
import { maskPhone, normalizePhone } from "@/lib/phone";
import { sendEmail } from "@/lib/notify/email";
import { sendSms } from "@/lib/notify/sms";
import { tFor } from "@/i18n/server";
import { appUrl } from "@/env";

/**
 * Phone-first accounts: SMS-code login and sign-up, and the account-page
 * flows that attach or change a phone number, add an email, or set a first
 * password on a phone-only account. The SMS code itself is handled by
 * phoneOtp.ts; this module decides what a verified code is allowed to do.
 */

function isUniqueConstraintOn(err: unknown, field: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    Array.isArray(err.meta?.target) &&
    (err.meta.target as string[]).includes(field)
  );
}

/** Tells the owner of an address that someone tried to use it, instead of telling the requester it is taken. */
async function notifyEmailAlreadyUsed(email: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: "MellaFx: an account already exists for this email",
    text: `Someone tried to add your email to another MellaFx account. If this was you, log in with this email instead or reset your password at ${appUrl()}/forgot-password.`,
  });
}

// ---------------------------------------------------------------------------
// Login / sign-up
// ---------------------------------------------------------------------------

export type PhoneLoginOutcome = LoginOutcome | { outcome: "NEEDS_PROFILE" };

/**
 * Exchanges a LOGIN code for the same outcomes as a password login. A code
 * for a number with no account instead issues the short-lived sign-up proof
 * cookie and asks for a profile. A correct code proves the phone, so it also
 * clears a password lockout.
 */
export async function loginWithPhoneOtp(phoneInput: string, code: string): Promise<PhoneLoginOutcome> {
  const phone = normalizePhone(phoneInput);
  if (!phone) return { outcome: "INVALID" };
  const check = await verifyPhoneOtp({ phone, code, purpose: "LOGIN" });
  const user = await prisma.user.findUnique({ where: { phone } });

  if (!check.ok) {
    await logAudit({ actorId: user?.id ?? null, action: "LOGIN_FAILED", targetType: "User", targetId: user?.id ?? null, after: { method: "phone_otp", reason: "bad_code" } });
    return { outcome: "INVALID" };
  }

  if (!user) {
    await createPhoneSignupProof(phone);
    return { outcome: "NEEDS_PROFILE" };
  }

  if (user.status === "DISABLED") {
    await logAudit({ actorId: user.id, action: "LOGIN_FAILED", targetType: "User", targetId: user.id, after: { method: "phone_otp", reason: "disabled" } });
    return { outcome: "DISABLED" };
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, ...(user.phoneVerifiedAt ? {} : { phoneVerifiedAt: new Date() }) },
  });

  if (updated.mfaEnabled) {
    await createMfaChallenge(updated.id);
    await logAudit({ actorId: updated.id, action: "LOGIN_MFA_CHALLENGE", targetType: "User", targetId: updated.id, after: { method: "phone_otp" } });
    return { outcome: "MFA_REQUIRED" };
  }

  await createSession(updated.id, updated.role);
  await logAudit({ actorId: updated.id, action: "LOGIN_SUCCESS", targetType: "User", targetId: updated.id, after: { method: "phone_otp" } });
  return { outcome: "SESSION", user: updated };
}

export type PhoneSignupOutcome =
  | { outcome: "EXPIRED" }
  | { outcome: "PHONE_TAKEN" }
  | { outcome: "CREATED"; user: User; emailAttached: boolean };

/**
 * Creates a TRADER account for the number proven by the sign-up proof cookie.
 * An optional email is attached only when no other account uses it; the
 * caller is never told which (the owner of that address gets a notice
 * instead), so sign-up cannot be used to probe for registered emails.
 */
export async function completePhoneSignup(input: { name: string; email?: string; locale: string; referralCode?: string | null }): Promise<PhoneSignupOutcome> {
  const phone = await readPhoneSignupProof();
  if (!phone) return { outcome: "EXPIRED" };

  let email = input.email ?? null;
  if (email && (await prisma.user.findUnique({ where: { email }, select: { id: true } }))) {
    await notifyEmailAlreadyUsed(email);
    email = null;
  }

  const create = (withEmail: string | null) =>
    prisma.user.create({
      data: { name: input.name, email: withEmail, phone, phoneVerifiedAt: new Date(), passwordHash: null, role: "TRADER", locale: input.locale },
    });

  let user: User;
  try {
    user = await create(email);
  } catch (err) {
    if (isUniqueConstraintOn(err, "phone")) {
      // Registered in between (another tab or a concurrent request): make them log in again.
      await clearPhoneSignupProof();
      return { outcome: "PHONE_TAKEN" };
    }
    if (!isUniqueConstraintOn(err, "email")) throw err;
    // The email was taken between the check and the insert.
    email = null;
    try {
      user = await create(null);
    } catch (retryErr) {
      if (!isUniqueConstraintOn(retryErr, "phone")) throw retryErr;
      await clearPhoneSignupProof();
      return { outcome: "PHONE_TAKEN" };
    }
  }

  await logAudit({ actorId: user.id, action: "USER_REGISTERED", targetType: "User", targetId: user.id, after: { method: "phone", emailAttached: !!email } });
  await attachReferral(user.id, input.referralCode);
  if (email) await sendEmailVerification(user.id);
  await clearPhoneSignupProof();
  await createSession(user.id, user.role);
  return { outcome: "CREATED", user, emailAttached: !!email };
}

// ---------------------------------------------------------------------------
// Account page: phone, email and first password
// ---------------------------------------------------------------------------

type AccountOtpRequest = { purpose: "CHANGE_PHONE"; phone: string } | { purpose: "SET_PASSWORD" };

/**
 * Sends a CHANGE_PHONE code to a new number, or a SET_PASSWORD code to the
 * account's verified number. Whether the new number belongs to someone else
 * is only checked once its code is entered (by then the caller has proven
 * they hold that phone), so this cannot be used to probe for registered numbers.
 */
export async function requestAccountOtp(userId: string, input: AccountOtpRequest, ctx: { ip: string | null }): Promise<RequestOtpResult> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (input.purpose === "CHANGE_PHONE") {
    const phone = normalizePhone(input.phone);
    if (phone && phone === user.phone && user.phoneVerifiedAt) throw new ConflictError("This is already your verified phone number");
    return requestPhoneOtp({ phone: input.phone, purpose: "CHANGE_PHONE", ip: ctx.ip, locale: user.locale });
  }
  if (user.passwordHash) throw new ConflictError("Your account already has a password. Use Change password instead.");
  if (!user.phone || !user.phoneVerifiedAt) throw new ConflictError("Verify a phone number first");
  return requestPhoneOtp({ phone: user.phone, purpose: "SET_PASSWORD", ip: ctx.ip, locale: user.locale });
}

const PHONE_UNAVAILABLE = "This phone number can't be used for your account. Contact support if you think this is a mistake.";

/**
 * Attaches (or verifies) a phone number after its CHANGE_PHONE code. The
 * phone is a login credential, so other sessions are signed out when it
 * changes, and the previous number and the email on file are told.
 */
export async function changePhone(userId: string, sessionId: string, phoneInput: string, code: string): Promise<{ phone: string }> {
  const phone = normalizePhone(phoneInput);
  if (!phone) throw new AuthError("Enter a valid phone number", 400);
  const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const check = await verifyPhoneOtp({ phone, code, purpose: "CHANGE_PHONE" });
  if (!check.ok) throw new AuthError("Invalid or expired code", 400, "INVALID_CODE");

  const owner = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  if (owner && owner.id !== userId) {
    await logAudit({ actorId: userId, action: "PHONE_CHANGE_REJECTED", targetType: "User", targetId: userId, after: { phone: maskPhone(phone), reason: "in_use" } });
    throw new ConflictError(PHONE_UNAVAILABLE);
  }

  const changed = before.phone !== phone;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { phone, phoneVerifiedAt: new Date() } });
      await logAudit(
        { actorId: userId, action: changed ? "PHONE_CHANGED" : "PHONE_VERIFIED", targetType: "User", targetId: userId, before: { phone: before.phone ? maskPhone(before.phone) : null }, after: { phone: maskPhone(phone) } },
        tx,
      );
      if (changed) {
        await revokeAllSessionsForUser(userId, tx, { exceptSessionId: sessionId });
        await logAudit({ actorId: userId, action: "SESSIONS_REVOKED", targetType: "User", targetId: userId, after: { reason: "phone_changed", kept: sessionId } }, tx);
      }
    });
  } catch (err) {
    if (isUniqueConstraintOn(err, "phone")) throw new ConflictError(PHONE_UNAVAILABLE);
    throw err;
  }

  if (changed) {
    const t = tFor(before.locale);
    if (before.phone && before.phoneVerifiedAt) await sendSms({ to: before.phone, message: t("auth.sms.phoneChanged", { phone: maskPhone(phone) }) });
    if (before.email) {
      await sendEmail({
        to: before.email,
        subject: "Your MellaFx phone number was changed",
        text: `Hi ${before.name},\n\nThe phone number on your MellaFx account was changed to ${maskPhone(phone)}. If this was not you, reset your password and contact support immediately.`,
      });
    }
  }
  return { phone };
}

/**
 * Adds an email to an account that has none, and sends the verification
 * link. Resolves the same way whether or not the address was free (the
 * existing owner is notified instead), so it cannot be used to look up emails.
 */
export async function addEmail(userId: string, email: string): Promise<{ attached: boolean }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.email) throw new ConflictError("Your account already has an email address");

  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    await notifyEmailAlreadyUsed(email);
    return { attached: false };
  }
  try {
    const claimed = await prisma.user.updateMany({ where: { id: userId, email: null }, data: { email, emailVerifiedAt: null } });
    if (claimed.count === 0) throw new ConflictError("Your account already has an email address");
  } catch (err) {
    if (!isUniqueConstraintOn(err, "email")) throw err;
    await notifyEmailAlreadyUsed(email);
    return { attached: false };
  }
  await logAudit({ actorId: userId, action: "EMAIL_ADDED", targetType: "User", targetId: userId });
  await sendEmailVerification(userId);
  return { attached: true };
}

/**
 * Sets the first password on a phone-only account. Requires a fresh
 * SET_PASSWORD code sent to the account's verified phone; like a password
 * change, every other session is signed out.
 */
export async function setInitialPassword(userId: string, sessionId: string, code: string, newPassword: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.passwordHash) throw new ConflictError("Your account already has a password. Use Change password instead.");
  if (!user.phone || !user.phoneVerifiedAt) throw new ConflictError("Verify a phone number first");

  const check = await verifyPhoneOtp({ phone: user.phone, code, purpose: "SET_PASSWORD" });
  if (!check.ok) throw new AuthError("Invalid or expired code", 400, "INVALID_CODE");

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    // Conditional on "still no password" so two concurrent requests cannot both set one.
    const claimed = await tx.user.updateMany({ where: { id: userId, passwordHash: null }, data: { passwordHash, passwordChangedAt: new Date() } });
    if (claimed.count === 0) throw new ConflictError("Your account already has a password. Use Change password instead.");
    await revokeAllSessionsForUser(userId, tx, { exceptSessionId: sessionId });
    await logAudit({ actorId: userId, action: "PASSWORD_SET", targetType: "User", targetId: userId, after: { method: "phone_otp" } }, tx);
    await logAudit({ actorId: userId, action: "SESSIONS_REVOKED", targetType: "User", targetId: userId, after: { reason: "password_set", kept: sessionId } }, tx);
  });
}
