import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { TestFixtures } from "./helpers/fixtures";

/**
 * Phone (SMS OTP) login, sign-up and account flows against a real database.
 * `next/headers` is stubbed with an in-memory cookie jar (so session, MFA and
 * sign-up proof cookies round-trip between calls), SMS and email delivery
 * are captured instead of sent, and Chapa is mocked for the purchase check.
 */
const h = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
  sms: [] as { to: string; message: string }[],
  emails: [] as { to: string; subject: string; text: string }[],
  smsConfigured: true,
  attachReferral: vi.fn<(userId: string, code: string | null | undefined) => Promise<void>>(async () => undefined),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h.cookieJar.has(name) ? { name, value: h.cookieJar.get(name)! } : undefined),
    set: (name: string, value: string, opts?: { maxAge?: number }) => (opts?.maxAge === 0 || value === "" ? h.cookieJar.delete(name) : h.cookieJar.set(name, value)),
    delete: (name: string) => h.cookieJar.delete(name),
  }),
  headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "203.0.113.9", "accept-language": "am-ET,am;q=0.9" }),
}));

vi.mock("@/lib/notify/sms", () => ({
  sendSms: async (input: { to: string; message: string }) => {
    h.sms.push(input);
    return { delivered: true, provider: "generic" };
  },
  smsConfigured: () => h.smsConfigured,
}));

vi.mock("@/lib/notify/email", () => ({
  sendEmail: async (input: { to: string; subject: string; text: string }) => {
    h.emails.push(input);
    return { delivered: true };
  },
}));

vi.mock("@/lib/services/referrals", () => ({ REFERRAL_COOKIE: "mella_ref", attachReferral: h.attachReferral }));

vi.mock("@/lib/services/chapa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/chapa")>();
  return { ...actual, initializeChapaTransaction: vi.fn(async () => ({ checkoutUrl: "https://checkout.chapa.co/checkout/payment/mock" })) };
});

const { requestPhoneOtp, verifyPhoneOtp, OTP_MAX_ATTEMPTS } = await import("@/lib/services/phoneOtp");
const { loginWithPhoneOtp, changePhone, setInitialPassword, addEmail, requestAccountOtp } = await import("@/lib/services/phoneAuth");
const { loginWithPassword, registerUser } = await import("@/lib/services/auth");
const { hashPassword, verifyPassword } = await import("@/lib/auth/password");
const { sessionCookieName } = await import("@/lib/auth/session");
const otpRequestRoute = await import("@/app/api/auth/otp/request/route");
const otpVerifyRoute = await import("@/app/api/auth/otp/verify/route");
const otpCompleteRoute = await import("@/app/api/auth/otp/complete/route");
const loginRoute = await import("@/app/api/auth/login/route");
const registerRoute = await import("@/app/api/auth/register/route");
const purchasesRoute = await import("@/app/api/trader/purchases/route");

const SIGNUP_COOKIE = "mellafx_phone_signup";
const fixtures = new TestFixtures();
const phonesUsed = new Set<string>();

/** A fresh, valid Ethiopian mobile number per call (tests share one database). */
function newPhone(): string {
  const phone = `+2519${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  phonesUsed.add(phone);
  return phone;
}

function lastCode(phone: string): string {
  const sms = [...h.sms].reverse().find((s) => s.to === phone);
  const match = sms && /#(\d{6})$/.exec(sms.message);
  if (!match) throw new Error(`no code sent to ${phone}`);
  return match[1];
}

function wrongCode(code: string): string {
  return code === "000000" ? "111111" : "000000";
}

function post(path: string, body: unknown, cookies: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") },
  });
}

async function createPhoneUser(data: { phone?: string; verified?: boolean; password?: string; email?: string } = {}) {
  const phone = data.phone ?? newPhone();
  const user = await prisma.user.create({
    data: {
      name: "Vitest Phone User",
      phone,
      phoneVerifiedAt: data.verified === false ? null : new Date(),
      email: data.email ?? null,
      passwordHash: data.password ? await hashPassword(data.password) : null,
      role: "TRADER",
    },
  });
  fixtures.trackUser(user.id);
  return user;
}

/** Makes the most recent code for `phone` older than the resend cooldown. */
async function ageCodes(phone: string, seconds: number) {
  const rows = await prisma.phoneOtp.findMany({ where: { phone } });
  for (const row of rows) {
    await prisma.phoneOtp.update({ where: { id: row.id }, data: { createdAt: new Date(row.createdAt.getTime() - seconds * 1000) } });
  }
}

beforeEach(() => {
  h.sms.length = 0;
  h.emails.length = 0;
  h.smsConfigured = true;
  h.attachReferral.mockClear();
});

afterEach(async () => {
  h.cookieJar.clear();
  await prisma.phoneOtp.deleteMany({ where: { phone: { in: [...phonesUsed] } } });
  const created = await prisma.user.findMany({ where: { phone: { in: [...phonesUsed] } }, select: { id: true } });
  for (const u of created) fixtures.trackUser(u.id);
  await fixtures.cleanup();
  phonesUsed.clear();
});

describe("requestPhoneOtp", () => {
  it("stores only an HMAC, texts the code in the user's language with the WebOTP line, and normalises the number", async () => {
    const phone = newPhone();
    const local = `0${phone.slice(4, 7)} ${phone.slice(7, 10)} ${phone.slice(10)}`;
    const result = await requestPhoneOtp({ phone: local, purpose: "LOGIN", ip: "203.0.113.9", locale: "am" });
    expect(result).toMatchObject({ ok: true, phone, expiresInSec: 300, retryAfterSec: 60 });

    const code = lastCode(phone);
    const row = await prisma.phoneOtp.findFirstOrThrow({ where: { phone } });
    expect(row.codeHash).not.toContain(code);
    expect(row.ip).toBe("203.0.113.9");
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeGreaterThan(290_000);
    const message = h.sms.at(-1)!.message;
    expect(message).toMatch(/[ሀ-፿]/); // Amharic (request locale, no account yet)
    expect(message.endsWith(`@localhost #${code}`)).toBe(true);
  });

  it("uses the saved language of an existing account over the request's", async () => {
    const user = await createPhoneUser();
    await prisma.user.update({ where: { id: user.id }, data: { locale: "en" } });
    await requestPhoneOtp({ phone: user.phone!, purpose: "LOGIN", locale: "am" });
    expect(h.sms.at(-1)!.message).toContain("MellaFx code:");
  });

  it("answers identically for registered and unknown numbers", async () => {
    const user = await createPhoneUser();
    const known = await requestPhoneOtp({ phone: user.phone!, purpose: "LOGIN" });
    const unknown = await requestPhoneOtp({ phone: newPhone(), purpose: "LOGIN" });
    expect(Object.keys(known).sort()).toEqual(Object.keys(unknown).sort());
    expect({ ...known, phone: "" }).toEqual({ ...unknown, phone: "" });
  });

  it("enforces a 60 s per-number cooldown with retryAfterSec", async () => {
    const phone = newPhone();
    expect((await requestPhoneOtp({ phone, purpose: "LOGIN" })).ok).toBe(true);
    const again = await requestPhoneOtp({ phone, purpose: "LOGIN" });
    expect(again).toMatchObject({ ok: false, reason: "COOLDOWN" });
    if (again.ok || !("retryAfterSec" in again)) throw new Error("expected cooldown");
    expect(again.retryAfterSec).toBeGreaterThan(0);
    expect(again.retryAfterSec).toBeLessThanOrEqual(60);
    expect(h.sms).toHaveLength(1);

    await ageCodes(phone, 61);
    expect((await requestPhoneOtp({ phone, purpose: "LOGIN" })).ok).toBe(true);
  });

  it("serialises concurrent requests for one number so only one code is sent", async () => {
    const phone = newPhone();
    const results = await Promise.all(Array.from({ length: 5 }, () => requestPhoneOtp({ phone, purpose: "LOGIN" })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.phoneOtp.count({ where: { phone } })).toBe(1);
  });

  it("caps a number at 5 codes per hour", async () => {
    const phone = newPhone();
    for (let i = 0; i < 5; i++) {
      expect((await requestPhoneOtp({ phone, purpose: "LOGIN" })).ok).toBe(true);
      await ageCodes(phone, 61);
    }
    const capped = await requestPhoneOtp({ phone, purpose: "LOGIN" });
    expect(capped).toMatchObject({ ok: false, reason: "HOURLY_LIMIT" });
    if (capped.ok || !("retryAfterSec" in capped)) throw new Error("expected hourly limit");
    expect(capped.retryAfterSec).toBeGreaterThan(60 * 60 - 6 * 61 - 5);

    await ageCodes(phone, 60 * 60);
    expect((await requestPhoneOtp({ phone, purpose: "LOGIN" })).ok).toBe(true);
  });

  it("invalidates the previous code for the same number and purpose", async () => {
    const phone = newPhone();
    await requestPhoneOtp({ phone, purpose: "LOGIN" });
    const first = lastCode(phone);
    await ageCodes(phone, 61);
    await requestPhoneOtp({ phone, purpose: "LOGIN" });
    const second = lastCode(phone);
    if (first !== second) expect((await verifyPhoneOtp({ phone, code: first, purpose: "LOGIN" })).ok).toBe(false);
    expect((await verifyPhoneOtp({ phone, code: second, purpose: "LOGIN" })).ok).toBe(true);
  });

  it("fails closed in production when no SMS provider is configured", async () => {
    const env = process.env as Record<string, string>;
    const original = env.NODE_ENV;
    h.smsConfigured = false;
    env.NODE_ENV = "production";
    try {
      expect(await requestPhoneOtp({ phone: newPhone(), purpose: "LOGIN" })).toEqual({ ok: false, reason: "UNAVAILABLE" });
    } finally {
      env.NODE_ENV = original;
    }
    expect(h.sms).toHaveLength(0);
  });

  it("rejects an invalid number", async () => {
    expect(await requestPhoneOtp({ phone: "0111234567", purpose: "LOGIN" })).toEqual({ ok: false, reason: "INVALID_PHONE" });
  });
});

describe("verifyPhoneOtp", () => {
  it("accepts a code exactly once", async () => {
    const phone = newPhone();
    await requestPhoneOtp({ phone, purpose: "LOGIN" });
    const code = lastCode(phone);
    expect(await verifyPhoneOtp({ phone, code, purpose: "LOGIN" })).toEqual({ ok: true, phone });
    expect((await verifyPhoneOtp({ phone, code, purpose: "LOGIN" })).ok).toBe(false);
  });

  it("rejects an expired code", async () => {
    const phone = newPhone();
    await requestPhoneOtp({ phone, purpose: "LOGIN" });
    await prisma.phoneOtp.updateMany({ where: { phone }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await verifyPhoneOtp({ phone, code: lastCode(phone), purpose: "LOGIN" })).ok).toBe(false);
  });

  it("kills the code after 5 wrong attempts, even if the right one follows", async () => {
    const phone = newPhone();
    await requestPhoneOtp({ phone, purpose: "LOGIN" });
    const code = lastCode(phone);
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) expect((await verifyPhoneOtp({ phone, code: wrongCode(code), purpose: "LOGIN" })).ok).toBe(false);
    expect((await verifyPhoneOtp({ phone, code, purpose: "LOGIN" })).ok).toBe(false);
    expect((await prisma.phoneOtp.findFirstOrThrow({ where: { phone } })).attempts).toBe(OTP_MAX_ATTEMPTS);
  });

  it("does not let parallel guesses exceed the attempt budget", async () => {
    const phone = newPhone();
    await requestPhoneOtp({ phone, purpose: "LOGIN" });
    const code = lastCode(phone);
    await Promise.all(Array.from({ length: 12 }, () => verifyPhoneOtp({ phone, code: wrongCode(code), purpose: "LOGIN" })));
    expect((await prisma.phoneOtp.findFirstOrThrow({ where: { phone } })).attempts).toBe(OTP_MAX_ATTEMPTS);
    expect((await verifyPhoneOtp({ phone, code, purpose: "LOGIN" })).ok).toBe(false);
  });

  it("does not accept a code for another purpose or number, and accepts local formats of the right number", async () => {
    const phone = newPhone();
    await requestPhoneOtp({ phone, purpose: "LOGIN" });
    const code = lastCode(phone);
    expect((await verifyPhoneOtp({ phone, code, purpose: "SET_PASSWORD" })).ok).toBe(false);
    expect((await verifyPhoneOtp({ phone: newPhone(), code, purpose: "LOGIN" })).ok).toBe(false);
    expect((await verifyPhoneOtp({ phone: `0${phone.slice(4)}`, code: `${code.slice(0, 3)} ${code.slice(3)}`, purpose: "LOGIN" })).ok).toBe(true);
  });
});

describe("phone login (service)", () => {
  it("logs in an existing user: session, verified phone, lockout cleared, audited", async () => {
    const user = await createPhoneUser({ verified: false, password: "TestPassword123!" });
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 7, lockedUntil: new Date(Date.now() + 600_000) } });
    await requestPhoneOtp({ phone: user.phone!, purpose: "LOGIN" });

    const result = await loginWithPhoneOtp(user.phone!, lastCode(user.phone!));
    expect(result.outcome).toBe("SESSION");
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.phoneVerifiedAt).not.toBeNull();
    expect(after.failedLoginCount).toBe(0);
    expect(after.lockedUntil).toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { actorId: user.id, action: "LOGIN_SUCCESS" } });
    expect(audit.after).toEqual({ method: "phone_otp" });
  });

  it("audits a wrong code as LOGIN_FAILED against the account", async () => {
    const user = await createPhoneUser();
    await requestPhoneOtp({ phone: user.phone!, purpose: "LOGIN" });
    expect((await loginWithPhoneOtp(user.phone!, wrongCode(lastCode(user.phone!)))).outcome).toBe("INVALID");
    expect(await prisma.auditLog.count({ where: { actorId: user.id, action: "LOGIN_FAILED" } })).toBe(1);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("defers to the TOTP challenge when MFA is enabled", async () => {
    const user = await createPhoneUser();
    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true, mfaSecretEnc: "placeholder" } });
    await requestPhoneOtp({ phone: user.phone!, purpose: "LOGIN" });
    expect((await loginWithPhoneOtp(user.phone!, lastCode(user.phone!))).outcome).toBe("MFA_REQUIRED");
    expect(h.cookieJar.has("mellafx_mfa")).toBe(true);
    expect(h.cookieJar.has(sessionCookieName())).toBe(false);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("refuses a disabled user after a correct code", async () => {
    const user = await createPhoneUser();
    await prisma.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });
    await requestPhoneOtp({ phone: user.phone!, purpose: "LOGIN" });
    expect((await loginWithPhoneOtp(user.phone!, lastCode(user.phone!))).outcome).toBe("DISABLED");
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("phone login and sign-up (routes)", () => {
  it("request → verify for an existing user returns the /api/auth/login body and a session cookie", async () => {
    const user = await createPhoneUser({ email: `vitest-phone-${Date.now()}@example.test` });
    const req = await otpRequestRoute.POST(post("/api/auth/otp/request", { phone: user.phone }));
    expect(req.status).toBe(200);
    expect(await req.json()).toMatchObject({ ok: true, retryAfterSec: 60 });

    const res = await otpVerifyRoute.POST(post("/api/auth/otp/verify", { phone: user.phone, code: lastCode(user.phone!) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: "TRADER",
      emailVerified: false,
      phoneVerified: true,
      mfaEnabled: false,
    });
    expect(h.cookieJar.has(sessionCookieName())).toBe(true);
  });

  it("returns 429 with retryAfterSec on cooldown and 401 for a wrong code", async () => {
    const phone = newPhone();
    await otpRequestRoute.POST(post("/api/auth/otp/request", { phone }));
    const again = await otpRequestRoute.POST(post("/api/auth/otp/request", { phone }));
    expect(again.status).toBe(429);
    expect(again.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(await again.json()).toMatchObject({ code: "COOLDOWN" });

    const bad = await otpVerifyRoute.POST(post("/api/auth/otp/verify", { phone, code: wrongCode(lastCode(phone)) }));
    expect(bad.status).toBe(401);
  });

  it("returns 403 for a disabled user", async () => {
    const user = await createPhoneUser();
    await prisma.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });
    await requestPhoneOtp({ phone: user.phone!, purpose: "LOGIN" });
    const res = await otpVerifyRoute.POST(post("/api/auth/otp/verify", { phone: user.phone, code: lastCode(user.phone!) }));
    expect(res.status).toBe(403);
  });

  it("returns mfaRequired for an MFA user", async () => {
    const user = await createPhoneUser();
    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true, mfaSecretEnc: "placeholder" } });
    await requestPhoneOtp({ phone: user.phone!, purpose: "LOGIN" });
    const res = await otpVerifyRoute.POST(post("/api/auth/otp/verify", { phone: user.phone, code: lastCode(user.phone!) }));
    expect(await res.json()).toEqual({ mfaRequired: true });
  });

  it("signs up a new number: proof cookie → profile → account, session, referral, audit", async () => {
    const phone = newPhone();
    await requestPhoneOtp({ phone, purpose: "LOGIN" });
    const verify = await otpVerifyRoute.POST(post("/api/auth/otp/verify", { phone, code: lastCode(phone) }));
    expect(await verify.json()).toEqual({ needsProfile: true });
    expect(h.cookieJar.has(SIGNUP_COOKIE)).toBe(true);
    expect(h.cookieJar.has(sessionCookieName())).toBe(false);

    const email = `vitest-phone-signup-${Date.now()}@example.test`;
    const complete = await otpCompleteRoute.POST(post("/api/auth/otp/complete", { name: "  Abebe Kebede ", email: email.toUpperCase() }, { mella_ref: "FRIEND10" }));
    expect(complete.status).toBe(201);
    const body = await complete.json();
    expect(body).toMatchObject({ name: "Abebe Kebede", phone, email, role: "TRADER", phoneVerified: true, emailVerified: false, emailAttached: true });

    const user = await prisma.user.findUniqueOrThrow({ where: { phone } });
    expect(user.passwordHash).toBeNull();
    expect(user.phoneVerifiedAt).not.toBeNull();
    expect(user.locale).toBe("am"); // from Accept-Language
    expect(h.attachReferral).toHaveBeenCalledWith(user.id, "FRIEND10");
    expect(h.cookieJar.has(SIGNUP_COOKIE)).toBe(false);
    expect(h.cookieJar.has(sessionCookieName())).toBe(true);
    expect(await prisma.verificationToken.count({ where: { userId: user.id, type: "EMAIL_VERIFY" } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { actorId: user.id, action: "USER_REGISTERED" } });
    expect(audit.after).toEqual({ method: "phone", emailAttached: true });

    // The proof is single use: a second completion has nothing to go on.
    const replay = await otpCompleteRoute.POST(post("/api/auth/otp/complete", { name: "Someone Else" }));
    expect(replay.status).toBe(401);
  });

  it("does not attach an email that another account uses, and does not say why", async () => {
    const owner = await fixtures.createUser();
    const phone = newPhone();
    await requestPhoneOtp({ phone, purpose: "LOGIN" });
    await loginWithPhoneOtp(phone, lastCode(phone));
    const res = await otpCompleteRoute.POST(post("/api/auth/otp/complete", { name: "Hanna Tesfaye", email: owner.email }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.emailAttached).toBe(false);
    expect(body.email).toBeNull();
    expect(JSON.stringify(body)).not.toMatch(/taken|exists|already/i);
    expect((await prisma.user.findUniqueOrThrow({ where: { phone } })).email).toBeNull();
    expect(h.emails.some((m) => m.to === owner.email)).toBe(true); // the real owner is told
  });

  it("rejects completion without a valid proof cookie", async () => {
    expect((await otpCompleteRoute.POST(post("/api/auth/otp/complete", { name: "No Proof" }))).status).toBe(401);
    h.cookieJar.set(SIGNUP_COOKIE, "eyJhbGciOiJIUzI1NiJ9.eyJwdXJwb3NlIjoicGhvbmUtc2lnbnVwIiwicGhvbmUiOiIrMjUxOTExMDAwMDAwIn0.forged");
    expect((await otpCompleteRoute.POST(post("/api/auth/otp/complete", { name: "Forged Proof" }))).status).toBe(401);
  });

  it("answers 409 when the number was registered between verification and completion", async () => {
    const phone = newPhone();
    await requestPhoneOtp({ phone, purpose: "LOGIN" });
    expect((await loginWithPhoneOtp(phone, lastCode(phone))).outcome).toBe("NEEDS_PROFILE");
    await createPhoneUser({ phone });
    const res = await otpCompleteRoute.POST(post("/api/auth/otp/complete", { name: "Too Late" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "PHONE_TAKEN" });
    expect(h.cookieJar.has(SIGNUP_COOKIE)).toBe(false);
  });
});

describe("password login by phone number", () => {
  it("accepts the phone in any format as the identifier", async () => {
    const user = await createPhoneUser({ password: "TestPassword123!" });
    const local = `0${user.phone!.slice(4)}`;
    expect((await loginWithPassword(local, "TestPassword123!")).outcome).toBe("SESSION");
    expect((await loginWithPassword(user.phone!, "wrong-password-123")).outcome).toBe("INVALID");
    expect((await loginWithPassword(newPhone(), "TestPassword123!")).outcome).toBe("INVALID");
  });

  it("route accepts {identifier} and the legacy {email} body", async () => {
    const user = await createPhoneUser({ password: "TestPassword123!" });
    const byPhone = await loginRoute.POST(post("/api/auth/login", { identifier: user.phone, password: "TestPassword123!" }));
    expect(byPhone.status).toBe(200);
    expect((await byPhone.json()).id).toBe(user.id);

    const emailUser = await fixtures.createUser();
    const legacy = await loginRoute.POST(post("/api/auth/login", { email: emailUser.email.toUpperCase(), password: "TestPassword123!" }));
    expect(legacy.status).toBe(200);
    expect((await legacy.json()).id).toBe(emailUser.id);

    expect((await loginRoute.POST(post("/api/auth/login", { password: "x" }))).status).toBe(400);
  });

  it("a phone-only account (no password) fails like a wrong password", async () => {
    const user = await createPhoneUser();
    expect((await loginWithPassword(user.phone!, "anything-at-all-123")).outcome).toBe("INVALID");
  });
});

describe("email registration", () => {
  it("credits the referral cookie and ignores a phone number in the body", async () => {
    const email = `vitest-register-${Date.now()}@example.test`;
    const phone = newPhone();
    const res = await registerRoute.POST(post("/api/auth/register", { name: "Email User", email, password: "a-long-enough-passphrase", phone }, { mella_ref: "REF42" }));
    expect(res.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    fixtures.trackUser(user.id);
    expect(user.phone).toBeNull();
    expect(h.attachReferral).toHaveBeenCalledWith(user.id, "REF42");
  });

  it("does not credit a referral when the email already existed", async () => {
    const existing = await fixtures.createUser();
    expect((await registerUser({ name: "Dup", email: existing.email, password: "a-long-enough-passphrase" })).created).toBe(false);
    const res = await registerRoute.POST(post("/api/auth/register", { name: "Dup", email: existing.email, password: "a-long-enough-passphrase" }, { mella_ref: "REF42" }));
    expect(res.status).toBe(201);
    expect(h.attachReferral).not.toHaveBeenCalled();
  });
});

describe("purchase gating", () => {
  async function loginByPhone(phone: string) {
    await ageCodes(phone, 61);
    await requestPhoneOtp({ phone, purpose: "LOGIN" });
    expect((await loginWithPhoneOtp(phone, lastCode(phone))).outcome).toBe("SESSION");
  }

  it("lets a phone-verified trader without an email start a purchase", async () => {
    const user = await createPhoneUser();
    const template = await fixtures.createTemplate({ price: 1500, currency: "ETB" });
    await loginByPhone(user.phone!);
    const res = await purchasesRoute.POST(post("/api/trader/purchases", { templateId: template.id }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ outcome: "REDIRECT" });
  });

  it("blocks a trader with neither a verified email nor a verified phone", async () => {
    const user = await fixtures.createUser();
    const template = await fixtures.createTemplate({ price: 1500, currency: "ETB" });
    expect((await loginWithPassword(user.email, "TestPassword123!")).outcome).toBe("SESSION");
    const res = await purchasesRoute.POST(post("/api/trader/purchases", { templateId: template.id }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "CONTACT_UNVERIFIED" });
  });
});

describe("account: phone, email and first password", () => {
  async function sessionFor(userId: string) {
    return prisma.session.create({ data: { userId, expiresAt: new Date(Date.now() + 86_400_000) } });
  }

  it("changes the phone after a code to the new number, signs out other sessions and tells the old number", async () => {
    const user = await createPhoneUser();
    const keep = await sessionFor(user.id);
    const other = await sessionFor(user.id);
    const next = newPhone();

    const sent = await requestAccountOtp(user.id, { purpose: "CHANGE_PHONE", phone: next }, { ip: null });
    expect(sent.ok).toBe(true);
    await expect(changePhone(user.id, keep.id, next, wrongCode(lastCode(next)))).rejects.toThrow(/invalid or expired/i);
    await changePhone(user.id, keep.id, next, lastCode(next));

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.phone).toBe(next);
    expect(after.phoneVerifiedAt).not.toBeNull();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: keep.id } })).revokedAt).toBeNull();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: other.id } })).revokedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { actorId: user.id, action: "PHONE_CHANGED" } })).toBe(1);
    expect(h.sms.some((s) => s.to === user.phone && !/#\d{6}$/.test(s.message))).toBe(true);
  });

  it("refuses a number that belongs to another account, with a generic message, only after its code", async () => {
    const other = await createPhoneUser();
    const user = await createPhoneUser();
    const session = await sessionFor(user.id);
    const sent = await requestAccountOtp(user.id, { purpose: "CHANGE_PHONE", phone: other.phone! }, { ip: null });
    expect(sent.ok).toBe(true); // no probing at request time
    await expect(changePhone(user.id, session.id, other.phone!, lastCode(other.phone!))).rejects.toThrow(/can't be used/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).phone).toBe(user.phone);
  });

  it("verifies an existing unverified number without signing anyone out", async () => {
    const user = await createPhoneUser({ verified: false });
    const keep = await sessionFor(user.id);
    const other = await sessionFor(user.id);
    await requestAccountOtp(user.id, { purpose: "CHANGE_PHONE", phone: user.phone! }, { ip: null });
    await changePhone(user.id, keep.id, user.phone!, lastCode(user.phone!));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).phoneVerifiedAt).not.toBeNull();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: other.id } })).revokedAt).toBeNull();
    await expect(requestAccountOtp(user.id, { purpose: "CHANGE_PHONE", phone: user.phone! }, { ip: null })).rejects.toThrow(/already your verified/);
  });

  it("sets a first password with a SET_PASSWORD code, then password login by phone works", async () => {
    const user = await createPhoneUser();
    const keep = await sessionFor(user.id);
    const other = await sessionFor(user.id);
    await requestAccountOtp(user.id, { purpose: "SET_PASSWORD" }, { ip: null });
    const code = lastCode(user.phone!);
    await expect(setInitialPassword(user.id, keep.id, wrongCode(code), "brand-new-passphrase-1")).rejects.toThrow(/invalid or expired/i);
    await setInitialPassword(user.id, keep.id, code, "brand-new-passphrase-1");

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword("brand-new-passphrase-1", after.passwordHash!)).toBe(true);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: other.id } })).revokedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { actorId: user.id, action: "PASSWORD_SET" } })).toBe(1);
    expect((await loginWithPassword(user.phone!, "brand-new-passphrase-1")).outcome).toBe("SESSION");

    await expect(requestAccountOtp(user.id, { purpose: "SET_PASSWORD" }, { ip: null })).rejects.toThrow(/already has a password/);
  });

  it("will not send a SET_PASSWORD code without a verified phone", async () => {
    const user = await createPhoneUser({ verified: false });
    await expect(requestAccountOtp(user.id, { purpose: "SET_PASSWORD" }, { ip: null })).rejects.toThrow(/verify a phone/i);
  });

  it("adds a free email with a verification link, and silently skips a taken one", async () => {
    const owner = await fixtures.createUser();
    const user = await createPhoneUser();
    expect(await addEmail(user.id, owner.email)).toEqual({ attached: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBeNull();

    const email = `vitest-add-${Date.now()}@example.test`;
    expect(await addEmail(user.id, email)).toEqual({ attached: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(email);
    expect(h.emails.some((m) => m.to === email && /verify/i.test(m.subject))).toBe(true);
    await expect(addEmail(user.id, `second-${email}`)).rejects.toThrow(/already has an email/);
  });
});
