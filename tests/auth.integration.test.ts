import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { TestFixtures } from "./helpers/fixtures";

/**
 * Authentication service behaviours. `next/headers` (cookies/headers) is
 * stubbed because these run outside a Next request scope; the session rows
 * and audit entries are real.
 */
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "203.0.113.5" }),
}));

const { loginWithPassword, completeMfaLogin, requestPasswordReset, resetPassword, changePassword, beginMfaEnrolment, confirmMfaEnrolment } = await import("@/lib/services/auth");
const { consumeVerificationToken, createVerificationToken } = await import("@/lib/auth/tokens");
const { verifyPassword } = await import("@/lib/auth/password");
const { decryptSecret } = await import("@/lib/auth/mfa");
const OTPAuth = await import("otpauth");

const fixtures = new TestFixtures();
afterEach(async () => {
  cookieJar.clear();
  await fixtures.cleanup();
});

describe("loginWithPassword", () => {
  it("logs in with the right password, creates a session with ip/user agent, and audits it", async () => {
    const user = await fixtures.createUser();
    const result = await loginWithPassword(user.email, "TestPassword123!");
    expect(result.outcome).toBe("SESSION");
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.ip).toBe("203.0.113.5");
    expect(session.userAgent).toBe("vitest");
    const audit = await prisma.auditLog.findFirst({ where: { actorId: user.id, action: "LOGIN_SUCCESS" } });
    expect(audit?.ip).toBe("203.0.113.5");
  });

  it("returns the same INVALID outcome for an unknown email and a wrong password", async () => {
    const user = await fixtures.createUser();
    expect((await loginWithPassword("nobody@example.test", "whatever-password")).outcome).toBe("INVALID");
    expect((await loginWithPassword(user.email, "wrong-password-123")).outcome).toBe("INVALID");
    const failed = await prisma.auditLog.count({ where: { actorId: user.id, action: "LOGIN_FAILED" } });
    expect(failed).toBe(1);
  });

  it("locks the account after 10 consecutive failures, even with the correct password", async () => {
    const user = await fixtures.createUser();
    for (let i = 0; i < 10; i++) await loginWithPassword(user.email, "wrong-password-123");
    const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedUntil).not.toBeNull();
    expect((await loginWithPassword(user.email, "TestPassword123!")).outcome).toBe("INVALID");

    await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await loginWithPassword(user.email, "TestPassword123!")).outcome).toBe("SESSION");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.failedLoginCount).toBe(0);
    expect(after.lockedUntil).toBeNull();
  });

  it("refuses a DISABLED user after a correct password", async () => {
    const user = await fixtures.createUser();
    await prisma.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });
    expect((await loginWithPassword(user.email, "TestPassword123!")).outcome).toBe("DISABLED");
  });
});

describe("MFA", () => {
  it("enrols, then requires a TOTP code at login, and accepts a backup code once", async () => {
    const user = await fixtures.createUser("ADMIN");
    const enrolment = await beginMfaEnrolment(user.id);
    const secretEnc = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).mfaSecretEnc!;
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(decryptSecret(secretEnc)), digits: 6, period: 30 });
    expect(enrolment.secretBase32).toBe(decryptSecret(secretEnc));

    await expect(confirmMfaEnrolment(user.id, "000000")).rejects.toThrow();
    const { backupCodes } = await confirmMfaEnrolment(user.id, totp.generate());
    expect(backupCodes).toHaveLength(8);

    const first = await loginWithPassword(user.email, "TestPassword123!");
    expect(first.outcome).toBe("MFA_REQUIRED");
    expect((await completeMfaLogin(user.id, "123456")).outcome).toBe("INVALID");
    expect((await completeMfaLogin(user.id, totp.generate())).outcome).toBe("SESSION");

    expect((await completeMfaLogin(user.id, backupCodes[0])).outcome).toBe("SESSION");
    expect((await completeMfaLogin(user.id, backupCodes[0])).outcome).toBe("INVALID"); // single use
  });
});

describe("password reset and change", () => {
  it("issues a single-use, expiring reset token that revokes every session when used", async () => {
    const user = await fixtures.createUser();
    await loginWithPassword(user.email, "TestPassword123!");
    await requestPasswordReset(user.email);
    const token = await prisma.verificationToken.findFirstOrThrow({ where: { userId: user.id, type: "PASSWORD_RESET" } });
    expect(token.usedAt).toBeNull();

    // We only store the hash; recreate a raw token to exercise consume().
    const raw = await createVerificationToken(user.id, "PASSWORD_RESET", 15);
    expect(await resetPassword(raw, "brand-new-password-987")).toBe(true);
    expect(await resetPassword(raw, "another-password-987")).toBe(false); // consumed

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword("brand-new-password-987", updated.passwordHash!)).toBe(true);
    const live = await prisma.session.count({ where: { userId: user.id, revokedAt: null } });
    expect(live).toBe(0);
  });

  it("rejects an expired token", async () => {
    const user = await fixtures.createUser();
    const raw = await createVerificationToken(user.id, "EMAIL_VERIFY", -1);
    expect(await consumeVerificationToken(raw, "EMAIL_VERIFY")).toBeNull();
  });

  it("changing the password keeps the current session and revokes the others", async () => {
    const user = await fixtures.createUser();
    await loginWithPassword(user.email, "TestPassword123!");
    const keep = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    await prisma.session.create({ data: { userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) } });

    await changePassword(user.id, keep.id, "TestPassword123!", "completely-new-password-1");

    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions.find((s) => s.id === keep.id)?.revokedAt).toBeNull();
    expect(sessions.filter((s) => s.id !== keep.id).every((s) => s.revokedAt !== null)).toBe(true);
  });
});
