import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth/session";
import { issueCertificate } from "@/lib/services/certificates";
import { invalidateLeaderboardCache } from "@/lib/services/leaderboard";
import { REFERRAL_COOKIE } from "@/lib/services/referrals";
import { TestFixtures } from "./helpers/fixtures";

/**
 * Route- and page-level checks for the growth features: authorization on
 * every new API route, the request/response contracts the UI relies on, and
 * a server render of each new page (session and locale mocked) so a broken
 * page fails CI rather than only showing up in the browser.
 */

const getSessionUserMock = vi.fn<() => Promise<SessionUser | null>>();
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, getSessionUser: () => getSessionUserMock() };
});
vi.mock("@/i18n/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n/server")>();
  const { dictionaries } = await import("@/i18n/messages");
  return { ...actual, getLocale: async () => "en", getT: async () => actual.translator(dictionaries.en) };
});
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }) };
});
vi.mock("@/lib/services/chapa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/chapa")>();
  return { ...actual, initializeChapaTransaction: vi.fn(), verifyChapaTransaction: vi.fn() };
});

const validateRoute = await import("@/app/api/trader/coupons/validate/route");
const purchaseRoute = await import("@/app/api/trader/purchases/route");
const profileRoute = await import("@/app/api/trader/leaderboard/profile/route");
const adminCoupons = await import("@/app/api/admin/coupons/route");
const adminCoupon = await import("@/app/api/admin/coupons/[id]/route");
const adminReferrals = await import("@/app/api/admin/referrals/route");
const adminReferral = await import("@/app/api/admin/referrals/[id]/route");
const adminReferralSettings = await import("@/app/api/admin/referrals/settings/route");
const referralLink = await import("@/app/r/[code]/route");

const fixtures = new TestFixtures();
const couponIds: string[] = [];

beforeEach(() => {
  getSessionUserMock.mockReset();
  invalidateLeaderboardCache();
});
afterEach(async () => {
  await fixtures.cleanup();
  if (couponIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { targetType: "Coupon", targetId: { in: couponIds } } });
    await prisma.coupon.deleteMany({ where: { id: { in: couponIds.splice(0) } } });
  }
});

function session(user: { id: string; name: string; email: string | null; role: "ADMIN" | "TRADER" }): SessionUser {
  return { id: user.id, name: user.name, email: user.email, phone: null, role: user.role, status: "ACTIVE", mfaEnabled: false, emailVerifiedAt: new Date(), phoneVerifiedAt: null, sessionId: "s1" };
}

function json(method: string, url: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}

const params = <T>(p: T) => ({ params: Promise.resolve(p) });

function uniqueCode(prefix = "RT") {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

describe("authorization on growth API routes", () => {
  it("rejects anonymous and trader access to admin routes, and admins on trader routes", async () => {
    const trader = await fixtures.createUser();
    const admin = await fixtures.createUser("ADMIN");
    const adminCalls = [
      () => adminCoupons.GET(json("GET", "/api/admin/coupons")),
      () => adminCoupons.POST(json("POST", "/api/admin/coupons", {})),
      () => adminCoupon.PATCH(json("PATCH", "/api/admin/coupons/x", {}), params({ id: "x" })),
      () => adminReferrals.GET(json("GET", "/api/admin/referrals")),
      () => adminReferral.PATCH(json("PATCH", "/api/admin/referrals/x", { action: "APPROVE" }), params({ id: "x" })),
      () => adminReferralSettings.PUT(json("PUT", "/api/admin/referrals/settings", { commissionPercent: 10 })),
    ];
    for (const call of adminCalls) {
      getSessionUserMock.mockResolvedValue(null);
      expect((await call()).status).toBe(401);
      getSessionUserMock.mockResolvedValue(session({ ...trader, role: "TRADER" }));
      expect((await call()).status).toBe(403);
    }

    getSessionUserMock.mockResolvedValue(session({ ...admin, role: "ADMIN" }));
    expect((await validateRoute.POST(json("POST", "/api/trader/coupons/validate", { code: "X", templateId: "y" }))).status).toBe(403);
    expect((await profileRoute.PATCH(json("PATCH", "/api/trader/leaderboard/profile", { optIn: false }))).status).toBe(403);
  });
});

describe("coupon routes", () => {
  it("quotes a coupon, then buys with it (free) through the purchase route", async () => {
    const trader = await fixtures.createUser();
    const admin = await fixtures.createUser("ADMIN");
    const template = await fixtures.createTemplate({ price: 1200 });

    getSessionUserMock.mockResolvedValue(session({ ...admin, role: "ADMIN" }));
    const code = uniqueCode("FREE");
    const created = await adminCoupons.POST(json("POST", "/api/admin/coupons", { code: code.toLowerCase(), percentOff: 100, templateIds: [template.id], maxRedemptions: 5 }));
    expect(created.status).toBe(201);
    const coupon = await created.json();
    couponIds.push(coupon.id);
    expect(coupon).toMatchObject({ code, percentOff: 100, amountOff: null, perUserLimit: 1, active: true });

    const invalid = await adminCoupons.POST(json("POST", "/api/admin/coupons", { code: uniqueCode(), percentOff: 10, amountOff: 5 }));
    expect(invalid.status).toBe(400);

    getSessionUserMock.mockResolvedValue(session({ ...trader, role: "TRADER" }));
    const quote = await validateRoute.POST(json("POST", "/api/trader/coupons/validate", { code: code.toLowerCase(), templateId: template.id }));
    expect(await quote.json()).toEqual({ valid: true, code, listPrice: 1200, discount: 1200, finalAmount: 0 });

    const bad = await validateRoute.POST(json("POST", "/api/trader/coupons/validate", { code: "NOPE-NOPE", templateId: template.id }));
    expect(await bad.json()).toMatchObject({ valid: false, reason: "NOT_FOUND", listPrice: 1200, finalAmount: 1200 });

    const bought = await purchaseRoute.POST(json("POST", "/api/trader/purchases", { templateId: template.id, idempotencyKey: `rt-${Date.now()}`, couponCode: code, amount: 1 }));
    expect(bought.status).toBe(201);
    expect(await bought.json()).toMatchObject({ outcome: "ACTIVATED" });

    // Used once: a second attempt is refused with a stable reason code.
    const again = await purchaseRoute.POST(json("POST", "/api/trader/purchases", { templateId: template.id, couponCode: code }));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "COUPON_INVALID", reason: "USER_LIMIT" });

    getSessionUserMock.mockResolvedValue(session({ ...admin, role: "ADMIN" }));
    const listed = await (await adminCoupons.GET(json("GET", `/api/admin/coupons?search=${code}`))).json();
    expect(listed.items[0]).toMatchObject({ code, redeemedCount: 1, _count: { purchases: 1 } });
    const locked = await adminCoupon.PATCH(json("PATCH", `/api/admin/coupons/${coupon.id}`, { code: uniqueCode() }), params({ id: coupon.id }));
    expect(locked.status).toBe(409);
    const deactivated = await adminCoupon.PATCH(json("PATCH", `/api/admin/coupons/${coupon.id}`, { active: false }), params({ id: coupon.id }));
    expect(await deactivated.json()).toMatchObject({ active: false });
  });
});

describe("referral routes", () => {
  it("sets the referral cookie only for well-formed codes and redirects to sign-up", async () => {
    const good = await referralLink.GET(json("GET", "/r/abcd2345"), params({ code: "abcd2345" }));
    expect(good.status).toBe(307);
    expect(good.headers.get("location")).toMatch(/\/register$/);
    const cookie = good.cookies.get(REFERRAL_COOKIE);
    expect(cookie).toMatchObject({ value: "ABCD2345", httpOnly: true, sameSite: "lax", maxAge: 30 * 24 * 60 * 60, path: "/" });

    const bad = await referralLink.GET(json("GET", "/r/<script>"), params({ code: "<script>" }));
    expect(bad.status).toBe(307);
    expect(bad.cookies.get(REFERRAL_COOKIE)).toBeUndefined();
  });

  it("validates the commission setting range", async () => {
    const admin = await fixtures.createUser("ADMIN");
    getSessionUserMock.mockResolvedValue(session({ ...admin, role: "ADMIN" }));
    const before = await prisma.systemSetting.findUnique({ where: { key: "referral.commissionPercent" } });
    try {
      expect((await adminReferralSettings.PUT(json("PUT", "/api/admin/referrals/settings", { commissionPercent: 75 }))).status).toBe(400);
      const ok = await adminReferralSettings.PUT(json("PUT", "/api/admin/referrals/settings", { commissionPercent: 12.5 }));
      expect(await ok.json()).toEqual({ commissionPercent: 12.5 });
      expect(await (await adminReferralSettings.GET()).json()).toEqual({ commissionPercent: 12.5 });
    } finally {
      await prisma.systemSetting.deleteMany({ where: { key: "referral.commissionPercent" } });
      if (before) await prisma.systemSetting.create({ data: { key: before.key, value: before.value as never } });
    }
  });
});

describe("leaderboard profile route", () => {
  it("validates and saves the alias", async () => {
    const trader = await fixtures.createUser();
    getSessionUserMock.mockResolvedValue(session({ ...trader, role: "TRADER" }));
    const noAlias = await profileRoute.PATCH(json("PATCH", "/api/trader/leaderboard/profile", { optIn: true }));
    expect(noAlias.status).toBe(409);
    const alias = `rt ${Math.random().toString(36).slice(2, 10)}`;
    const saved = await profileRoute.PATCH(json("PATCH", "/api/trader/leaderboard/profile", { optIn: true, alias }));
    expect(await saved.json()).toEqual({ leaderboardOptIn: true, publicAlias: alias });
  });
});

// ---------------------------------------------------------------------------
// Server-rendered pages
// ---------------------------------------------------------------------------

const { I18nProvider } = await import("@/i18n/client");
const { ToastProvider } = await import("@/components/ui/Toast");
const { dictionaries } = await import("@/i18n/messages");

/** Renders an already-awaited server component tree with the providers the layouts supply. */
function render(tree: ReactElement): string {
  // I18nProvider's props type requires `children`, so it is passed as a prop here (no JSX in .ts tests).
  // eslint-disable-next-line react/no-children-prop
  return renderToString(createElement(I18nProvider, { locale: "en", messages: dictionaries.en, children: createElement(ToastProvider, null, tree) }));
}

describe("growth pages render", () => {
  it("renders the trader referrals, leaderboard, certificates and purchases pages", async () => {
    const trader = await fixtures.createUser();
    await prisma.user.update({ where: { id: trader.id }, data: { name: "Abebe Kebede" } });
    const template = await fixtures.createTemplate({ price: 1000 });
    const { purchase, account } = await fixtures.createPaidPurchase({ userId: trader.id, template });
    await prisma.purchase.update({ where: { id: purchase.id }, data: { listPrice: 1250, discountAmount: 250 } });
    await issueCertificate(prisma, { type: "CHALLENGE_PASSED", userId: trader.id, accountId: account.id });
    getSessionUserMock.mockResolvedValue(session({ ...trader, role: "TRADER" }));

    const referrals = render(await (await import("@/app/(trader)/referrals/page")).default());
    expect(referrals).toContain("Invite friends, earn birr");
    expect(referrals).toMatch(/http:\/\/localhost:3000\/r\/[2-9A-HJKMNP-Z]{8}/);
    expect(referrals).toContain("https://t.me/share/url?url=");

    const leaderboard = render(await (await import("@/app/(trader)/leaderboard/page")).default({ searchParams: Promise.resolve({ period: "all" }) }));
    expect(leaderboard).toContain("Your leaderboard profile");
    expect(leaderboard).toContain("Opt in to see your rank.");

    const certificates = render(await (await import("@/app/(trader)/certificates/page")).default());
    expect(certificates).toContain("Phase 1 Passed");
    expect(certificates).toMatch(/href="\/certificates\/[a-z2-7]{12}"/);

    const purchases = render(await (await import("@/app/(trader)/purchases/page")).default({ searchParams: Promise.resolve({}) }));
    expect(purchases).toContain("ETB 1,250.00");
    expect(purchases).toContain("−ETB 250.00 discount");
  });

  it("renders the public certificate page, its metadata and Open Graph image, and 404s unknown ids", async () => {
    const trader = await fixtures.createUser();
    await prisma.user.update({ where: { id: trader.id }, data: { name: "አበበ ከበደ" } });
    const template = await fixtures.createTemplate({ groupName: "Standard 2-Step", accountSize: 1_000_000, startingBalance: 1_000_000 });
    const account = await fixtures.createAccount({ userId: trader.id, template, status: "PASSED" });
    const cert = await issueCertificate(prisma, { type: "CHALLENGE_PASSED", userId: trader.id, accountId: account.id });
    const page = await import("@/app/certificates/[publicId]/page");

    const html = render(await page.default({ params: Promise.resolve({ publicId: cert.publicId }) }));
    expect(html).toContain("Certificate of Achievement");
    expect(html).toContain("Phase 1 Passed — 1,000,000 ETB Standard 2-Step");
    expect(html).toContain("አበበ ከ.");
    expect(html).toContain(cert.publicId);
    expect(html).not.toContain(trader.email);
    expect(html).not.toContain(trader.id);

    const meta = await page.generateMetadata({ params: Promise.resolve({ publicId: cert.publicId }) });
    expect(meta.openGraph).toMatchObject({ url: `http://localhost:3000/certificates/${cert.publicId}`, siteName: "MellaFx" });
    expect(meta.robots).toMatchObject({ index: false });

    const og = await (await import("@/app/certificates/[publicId]/opengraph-image")).default({ params: Promise.resolve({ publicId: cert.publicId }) });
    expect(og.status).toBe(200);
    expect(og.headers.get("content-type")).toBe("image/png");
    const png = Buffer.from(await og.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.length).toBeGreaterThan(10_000);

    await expect(page.default({ params: Promise.resolve({ publicId: "zzzzzzzzzzzz" }) })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    const missing = await (await import("@/app/certificates/[publicId]/opengraph-image")).default({ params: Promise.resolve({ publicId: "zzzzzzzzzzzz" }) });
    expect(missing.status).toBe(404);
  });
});
