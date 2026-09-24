import "server-only";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/lib/auth/password";
import { createMfaChallenge, createSession, revokeAllSessionsForUser } from "@/lib/auth/session";
import { consumeVerificationToken, createVerificationToken } from "@/lib/auth/tokens";
import { enableMfaForUser, generateBackupCodes, generateMfaEnrolment, matchBackupCode, verifyTotp } from "@/lib/auth/mfa";
import { logAudit } from "@/lib/services/audit";
import { sendEmail } from "@/lib/notify/email";
import { appUrl } from "@/env";
import { AuthError, ConflictError } from "@/lib/auth/guards";

const MAX_FAILED_LOGINS = 10;

/** Account label shown in authenticator apps (and bound into the TOTP URI). */
export function mfaLabel(user: Pick<User, "id" | "email" | "phone">): string {
  return user.email ?? user.phone ?? user.id;
}
const LOCKOUT_MINUTES = 15;

export type LoginOutcome =
  | { outcome: "SESSION"; user: Pick<User, "id" | "name" | "email" | "role" | "emailVerifiedAt" | "mfaEnabled"> }
  | { outcome: "MFA_REQUIRED" }
  | { outcome: "INVALID" }
  | { outcome: "DISABLED" };

/**
 * Password login. Constant-cost for unknown users (a dummy hash is checked),
 * locks the account for 15 minutes after 10 consecutive failures, and defers
 * to a TOTP challenge when MFA is enabled. Every attempt is audited.
 */
export async function loginWithPassword(email: string, password: string): Promise<LoginOutcome> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    await burnPasswordCheck(password);
    await logAudit({ actorId: null, action: "LOGIN_FAILED", targetType: "User", after: { reason: "unknown_email" } });
    return { outcome: "INVALID" };
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await burnPasswordCheck(password);
    await logAudit({ actorId: user.id, action: "LOGIN_FAILED", targetType: "User", targetId: user.id, after: { reason: "locked" } });
    return { outcome: "INVALID" };
  }

  // Phone-only accounts have no password: burn the same CPU and fail like a wrong password.
  const valid = user.passwordHash ? await verifyPassword(password, user.passwordHash) : (await burnPasswordCheck(password), false);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null },
    });
    await logAudit({ actorId: user.id, action: "LOGIN_FAILED", targetType: "User", targetId: user.id, after: { reason: "bad_password", failed, locked: lock } });
    return { outcome: "INVALID" };
  }

  if (user.status === "DISABLED") {
    await logAudit({ actorId: user.id, action: "LOGIN_FAILED", targetType: "User", targetId: user.id, after: { reason: "disabled" } });
    return { outcome: "DISABLED" };
  }

  if (user.failedLoginCount > 0 || user.lockedUntil) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  }

  if (user.mfaEnabled) {
    await createMfaChallenge(user.id);
    await logAudit({ actorId: user.id, action: "LOGIN_MFA_CHALLENGE", targetType: "User", targetId: user.id });
    return { outcome: "MFA_REQUIRED" };
  }

  await createSession(user.id, user.role);
  await logAudit({ actorId: user.id, action: "LOGIN_SUCCESS", targetType: "User", targetId: user.id });
  return { outcome: "SESSION", user };
}

/** Second login step: TOTP code or a backup code, exchanged for a real session. */
export async function completeMfaLogin(userId: string, code: string): Promise<LoginOutcome> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== "ACTIVE" || !user.mfaEnabled || !user.mfaSecretEnc) return { outcome: "INVALID" };

  let ok = verifyTotp(user.mfaSecretEnc, code, mfaLabel(user));
  if (!ok) {
    const hashes = Array.isArray(user.mfaBackupCodes) ? (user.mfaBackupCodes as string[]) : [];
    const idx = await matchBackupCode(hashes, code);
    if (idx >= 0) {
      ok = true;
      const remaining = hashes.filter((_, i) => i !== idx);
      await prisma.user.update({ where: { id: user.id }, data: { mfaBackupCodes: remaining } });
      await logAudit({ actorId: user.id, action: "MFA_BACKUP_CODE_USED", targetType: "User", targetId: user.id, after: { remaining: remaining.length } });
    }
  }
  if (!ok) {
    await logAudit({ actorId: user.id, action: "LOGIN_FAILED", targetType: "User", targetId: user.id, after: { reason: "bad_mfa_code" } });
    return { outcome: "INVALID" };
  }

  await createSession(user.id, user.role);
  await logAudit({ actorId: user.id, action: "LOGIN_SUCCESS", targetType: "User", targetId: user.id, after: { mfa: true } });
  return { outcome: "SESSION", user };
}

/**
 * Registration. Always answers the same way whether or not the email is
 * already taken (an existing address gets an email instead of a 409), so the
 * endpoint cannot be used to enumerate customers.
 */
export async function registerUser(input: { name: string; email: string; password: string; phone?: string }): Promise<{ created: boolean; userId?: string }> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    await sendEmail({
      to: input.email,
      subject: "MellaFx: an account already exists for this email",
      text: `Someone tried to register with your email on MellaFx. If this was you, log in instead or reset your password at ${appUrl()}/forgot-password.`,
    });
    return { created: false };
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, passwordHash, role: "TRADER", phone: input.phone ?? null },
  });
  await logAudit({ actorId: user.id, action: "USER_REGISTERED", targetType: "User", targetId: user.id });
  await sendEmailVerification(user.id);
  await createSession(user.id, user.role);
  return { created: true, userId: user.id };
}

export async function sendEmailVerification(userId: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt || !user.email) return;
  const token = await createVerificationToken(user.id, "EMAIL_VERIFY", 24 * 60);
  await sendEmail({
    to: user.email,
    subject: "Verify your MellaFx email",
    text: `Hi ${user.name},\n\nConfirm your email to activate purchases and payouts:\n${appUrl()}/verify-email?token=${token}\n\nThis link expires in 24 hours.`,
  });
}

export async function verifyEmail(token: string): Promise<boolean> {
  const userId = await consumeVerificationToken(token, "EMAIL_VERIFY");
  if (!userId) return false;
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  await logAudit({ actorId: userId, action: "EMAIL_VERIFIED", targetType: "User", targetId: userId });
  return true;
}

/** Always resolves; sends a reset link only if the account exists. */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;
  const token = await createVerificationToken(user.id, "PASSWORD_RESET", 15);
  await sendEmail({
    to: email,
    subject: "Reset your MellaFx password",
    text: `Hi ${user.name},\n\nReset your password (link valid for 15 minutes):\n${appUrl()}/reset-password?token=${token}\n\nIf you did not request this, ignore this email.`,
  });
  await logAudit({ actorId: user.id, action: "PASSWORD_RESET_REQUESTED", targetType: "User", targetId: user.id });
}

export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  const userId = await consumeVerificationToken(token, "PASSWORD_RESET");
  if (!userId) return false;
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
    await revokeAllSessionsForUser(userId, tx);
    await logAudit({ actorId: userId, action: "PASSWORD_RESET", targetType: "User", targetId: userId }, tx);
    await logAudit({ actorId: userId, action: "SESSIONS_REVOKED", targetType: "User", targetId: userId, after: { reason: "password_reset" } }, tx);
  });
  return true;
}

export async function changePassword(userId: string, sessionId: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const valid = user.passwordHash ? await verifyPassword(currentPassword, user.passwordHash) : false;
  if (!valid) throw new AuthError("Current password is incorrect", 400);
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: new Date() } });
    await revokeAllSessionsForUser(userId, tx, { exceptSessionId: sessionId });
    await logAudit({ actorId: userId, action: "PASSWORD_CHANGED", targetType: "User", targetId: userId }, tx);
    await logAudit({ actorId: userId, action: "SESSIONS_REVOKED", targetType: "User", targetId: userId, after: { reason: "password_changed", kept: sessionId } }, tx);
  });
}

// ---------------------------------------------------------------------------
// MFA enrolment
// ---------------------------------------------------------------------------

export async function beginMfaEnrolment(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.mfaEnabled) throw new ConflictError("MFA is already enabled");
  const enrolment = await generateMfaEnrolment(mfaLabel(user));
  // Stored but not enabled until a code proves the authenticator was set up.
  await prisma.user.update({ where: { id: userId }, data: { mfaSecretEnc: enrolment.secretEnc } });
  return { otpauthUrl: enrolment.otpauthUrl, qrDataUrl: enrolment.qrDataUrl, secretBase32: enrolment.secretBase32 };
}

export async function confirmMfaEnrolment(userId: string, code: string): Promise<{ backupCodes: string[] }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.mfaEnabled) throw new ConflictError("MFA is already enabled");
  if (!user.mfaSecretEnc) throw new ConflictError("Start MFA setup first");
  if (!verifyTotp(user.mfaSecretEnc, code, mfaLabel(user))) throw new AuthError("Invalid authentication code", 400);
  const codes = await generateBackupCodes();
  await enableMfaForUser(userId, codes.hashes);
  await logAudit({ actorId: userId, action: "MFA_ENABLED", targetType: "User", targetId: userId });
  return { backupCodes: codes.plain };
}

export async function disableMfa(userId: string, password: string, code: string, opts: { allowForAdmins: boolean }): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.mfaEnabled || !user.mfaSecretEnc) throw new ConflictError("MFA is not enabled");
  if (user.role === "ADMIN" && !opts.allowForAdmins) throw new AuthError("Admins cannot disable MFA", 403);
  const valid = user.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
  if (!valid || !verifyTotp(user.mfaSecretEnc, code, mfaLabel(user))) throw new AuthError("Invalid password or code", 400);
  await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecretEnc: null, mfaBackupCodes: [] } });
  await logAudit({ actorId: userId, action: "MFA_DISABLED", targetType: "User", targetId: userId });
}
