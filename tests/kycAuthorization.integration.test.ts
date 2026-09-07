import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth/session";
import { TestFixtures } from "./helpers/fixtures";

const getSessionUserMock = vi.fn<() => Promise<SessionUser | null>>();

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, getSessionUser: () => getSessionUserMock() };
});

const { POST: startKycPost } = await import("@/app/api/trader/kyc/route");
const { PATCH: decisionPatch } = await import("@/app/api/admin/kyc/[id]/decision/route");

function sessionUser(overrides: Partial<SessionUser>): SessionUser {
  return { id: "u1", name: "Test", email: "test@example.com", role: "TRADER", status: "ACTIVE", ...overrides };
}

const fixtures = new TestFixtures();

beforeEach(() => {
  getSessionUserMock.mockReset();
  process.env.DOJAH_APP_ID = "app-1";
  process.env.DOJAH_PUBLIC_KEY = "pub-1";
  process.env.DOJAH_SECRET_KEY = "secret-1";
  process.env.DOJAH_WIDGET_ID = "widget-1";
});
afterEach(() => fixtures.cleanup());

describe("POST /api/trader/kyc - error handling", () => {
  it("surfaces a clean 400 (not a raw 500) when Dojah isn't configured, without leaking internals", async () => {
    delete process.env.DOJAH_WIDGET_ID;
    const trader = await fixtures.createUser("TRADER");
    getSessionUserMock.mockResolvedValue(sessionUser({ id: trader.id, name: trader.name, email: trader.email, role: "TRADER" }));

    const res = await startKycPost();
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/unable to start verification/i);
    expect(JSON.stringify(body)).not.toMatch(/DOJAH_APP_ID|DOJAH_SECRET_KEY|at startProviderVerification/);
  });
});

describe("POST /api/trader/kyc - authentication and authorization", () => {
  it("rejects an unauthenticated KYC start request with 401", async () => {
    const before = await prisma.kycSubmission.count();
    getSessionUserMock.mockResolvedValue(null);
    const res = await startKycPost();
    expect(res.status).toBe(401);
    expect(await prisma.kycSubmission.count()).toBe(before); // no new row created
  });

  it("rejects an ADMIN using the trader-only start route with 403", async () => {
    getSessionUserMock.mockResolvedValue(sessionUser({ role: "ADMIN" }));
    const res = await startKycPost();
    expect(res.status).toBe(403);
  });

  it("allows an authenticated trader to start their own verification, using only their own session identity", async () => {
    const trader = await fixtures.createUser("TRADER");
    getSessionUserMock.mockResolvedValue(sessionUser({ id: trader.id, name: trader.name, email: trader.email, role: "TRADER" }));

    const res = await startKycPost();

    expect(res.status).toBe(201);
    const submission = await prisma.kycSubmission.findFirstOrThrow({ where: { userId: trader.id } });
    expect(submission.userId).toBe(trader.id); // always the session user - the route takes no body at all
  });

  it("a trader can never act on another trader's KYC submission, because the start route has no way to target one", async () => {
    // The POST /api/trader/kyc route takes no request body - there is no
    // submissionId, userId, or status field a client could supply to target
    // or influence another user's record. This is enforced by the route's
    // own signature (see src/app/api/trader/kyc/route.ts), not by a runtime
    // check, so it's demonstrated here structurally: two different traders
    // starting verification always produce their own, separate records.
    const traderA = await fixtures.createUser("TRADER");
    const traderB = await fixtures.createUser("TRADER");

    getSessionUserMock.mockResolvedValue(sessionUser({ id: traderA.id, name: traderA.name, email: traderA.email, role: "TRADER" }));
    await startKycPost();
    getSessionUserMock.mockResolvedValue(sessionUser({ id: traderB.id, name: traderB.name, email: traderB.email, role: "TRADER" }));
    await startKycPost();

    const submissionsA = await prisma.kycSubmission.findMany({ where: { userId: traderA.id } });
    const submissionsB = await prisma.kycSubmission.findMany({ where: { userId: traderB.id } });
    expect(submissionsA).toHaveLength(1);
    expect(submissionsB).toHaveLength(1);
    expect(submissionsA[0].id).not.toBe(submissionsB[0].id);
  });
});

describe("PATCH /api/admin/kyc/[id]/decision - admin-only KYC review", () => {
  it("rejects an unauthenticated request with 401", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const req = new NextRequest("http://localhost/api/admin/kyc/x/decision", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "APPROVED" }),
    });
    const res = await decisionPatch(req, { params: Promise.resolve({ id: "x" }) });
    expect(res.status).toBe(401);
  });

  it("rejects a TRADER attempting to decide their own (or any) KYC submission with 403 - a trader can never mark themselves verified", async () => {
    const trader = await fixtures.createUser("TRADER");
    const submission = await prisma.kycSubmission.create({
      data: { userId: trader.id, status: "PENDING", provider: "DOJAH", providerReference: `vitest-auth-${Date.now()}` },
    });
    getSessionUserMock.mockResolvedValue(sessionUser({ id: trader.id, role: "TRADER" }));

    const req = new NextRequest(`http://localhost/api/admin/kyc/${submission.id}/decision`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "APPROVED" }),
    });
    const res = await decisionPatch(req, { params: Promise.resolve({ id: submission.id }) });

    expect(res.status).toBe(403);
    const unchanged = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(unchanged.status).toBe("PENDING");
  });

  it("allows an ADMIN to decide a PENDING submission", async () => {
    const trader = await fixtures.createUser("TRADER");
    const admin = await fixtures.createUser("ADMIN");
    const submission = await prisma.kycSubmission.create({
      data: { userId: trader.id, status: "PENDING", provider: "DOJAH", providerReference: `vitest-auth-2-${Date.now()}` },
    });
    getSessionUserMock.mockResolvedValue(sessionUser({ id: admin.id, role: "ADMIN" }));

    const req = new NextRequest(`http://localhost/api/admin/kyc/${submission.id}/decision`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "APPROVED" }),
    });
    const res = await decisionPatch(req, { params: Promise.resolve({ id: submission.id }) });

    expect(res.status).toBe(200);
    const updated = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(updated.status).toBe("APPROVED");
  });
});
