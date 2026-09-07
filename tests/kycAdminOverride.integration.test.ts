// TEMPORARY DEVELOPMENT KYC OVERRIDE — REMOVE BEFORE PRODUCTION.
// This entire test file exists only to cover the temporary admin override
// feature (src/lib/services/kycVerification.ts's adminOverrideKycStatus,
// src/app/api/admin/kyc/[id]/override/route.ts). Delete this file together
// with those when the feature is removed - it does not test, and must
// never be used as a substitute for, real Dojah verification.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth/session";
import { adminOverrideKycStatus } from "@/lib/services/kycVerification";
import { TestFixtures } from "./helpers/fixtures";

const getSessionUserMock = vi.fn<() => Promise<SessionUser | null>>();

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, getSessionUser: () => getSessionUserMock() };
});

const { PATCH: overridePatch } = await import("@/app/api/admin/kyc/[id]/override/route");

function sessionUser(overrides: Partial<SessionUser>): SessionUser {
  return { id: "u1", name: "Test", email: "test@example.com", role: "TRADER", status: "ACTIVE", ...overrides };
}

async function createPendingSubmission(userId: string) {
  return prisma.kycSubmission.create({
    data: { userId, status: "PENDING", provider: "DOJAH", providerReference: `vitest-override-${Date.now()}-${Math.random()}` },
  });
}

function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/kyc/x/override", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const fixtures = new TestFixtures();
beforeEach(() => getSessionUserMock.mockReset());
afterEach(() => fixtures.cleanup());

describe("PATCH /api/admin/kyc/[id]/override - route-level authorization (TEMPORARY)", () => {
  it("rejects an unauthenticated request with 401", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const res = await overridePatch(patchRequest({ status: "APPROVED" }), { params: Promise.resolve({ id: "x" }) });
    expect(res.status).toBe(401);
  });

  it("rejects a TRADER with 403", async () => {
    const trader = await fixtures.createUser("TRADER");
    const submission = await createPendingSubmission(trader.id);
    getSessionUserMock.mockResolvedValue(sessionUser({ id: trader.id, role: "TRADER" }));

    const res = await overridePatch(patchRequest({ status: "APPROVED" }), { params: Promise.resolve({ id: submission.id }) });

    expect(res.status).toBe(403);
    const unchanged = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(unchanged.status).toBe("PENDING");
  });

  it("allows an ADMIN to manually change a trader's KYC status", async () => {
    const trader = await fixtures.createUser("TRADER");
    const admin = await fixtures.createUser("ADMIN");
    const submission = await createPendingSubmission(trader.id);
    getSessionUserMock.mockResolvedValue(sessionUser({ id: admin.id, role: "ADMIN" }));

    const res = await overridePatch(patchRequest({ status: "APPROVED" }), { params: Promise.resolve({ id: submission.id }) });

    expect(res.status).toBe(200);
    const updated = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(updated.status).toBe("APPROVED");
  });

  it("rejects an invalid/arbitrary status string with a validation error, never applying it", async () => {
    const trader = await fixtures.createUser("TRADER");
    const admin = await fixtures.createUser("ADMIN");
    const submission = await createPendingSubmission(trader.id);
    getSessionUserMock.mockResolvedValue(sessionUser({ id: admin.id, role: "ADMIN" }));

    const res = await overridePatch(patchRequest({ status: "SUPER_VERIFIED" }), { params: Promise.resolve({ id: submission.id }) });

    expect(res.status).toBe(400);
    const unchanged = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(unchanged.status).toBe("PENDING");
  });
});

describe("adminOverrideKycStatus (TEMPORARY) - behavior", () => {
  it("records the previous and new status, the acting admin, and a timestamp", async () => {
    const trader = await fixtures.createUser("TRADER");
    const admin = await fixtures.createUser("ADMIN");
    const submission = await createPendingSubmission(trader.id);

    const updated = await adminOverrideKycStatus(submission.id, "APPROVED", admin.id, "manual test");

    expect(updated.status).toBe("APPROVED");
    expect(updated.reviewerId).toBe(admin.id);
    expect(updated.reviewedAt).not.toBeNull();

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { targetType: "KycSubmission", targetId: submission.id, action: "KYC_ADMIN_OVERRIDE" },
    });
    expect(log.actorId).toBe(admin.id);
    expect((log.before as { status: string }).status).toBe("PENDING");
    expect((log.after as { status: string }).status).toBe("APPROVED");
  });

  it("is distinguishable from a real Dojah verification: manual override uses a different audit action than KYC_VERIFIED", async () => {
    const trader = await fixtures.createUser("TRADER");
    const admin = await fixtures.createUser("ADMIN");
    const submission = await createPendingSubmission(trader.id);

    await adminOverrideKycStatus(submission.id, "APPROVED", admin.id);

    const realVerificationLogs = await prisma.auditLog.count({
      where: { targetType: "KycSubmission", targetId: submission.id, action: "KYC_VERIFIED" },
    });
    const overrideLogs = await prisma.auditLog.count({
      where: { targetType: "KycSubmission", targetId: submission.id, action: "KYC_ADMIN_OVERRIDE" },
    });
    expect(realVerificationLogs).toBe(0);
    expect(overrideLogs).toBe(1);

    const log = await prisma.auditLog.findFirstOrThrow({ where: { targetType: "KycSubmission", targetId: submission.id, action: "KYC_ADMIN_OVERRIDE" } });
    expect(JSON.stringify(log.after)).toMatch(/manual|override/i);
  });

  it("does not put sensitive Fayda/identity information into the audit log", async () => {
    const trader = await fixtures.createUser("TRADER");
    const admin = await fixtures.createUser("ADMIN");
    const submission = await createPendingSubmission(trader.id);

    await adminOverrideKycStatus(submission.id, "REJECTED", admin.id, "testing rejection path");

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { targetType: "KycSubmission", targetId: submission.id, action: "KYC_ADMIN_OVERRIDE" },
    });
    expect(JSON.stringify(log)).not.toMatch(/fayda/i);
  });

  it("is idempotent: calling it again with the same target status is a no-op (no duplicate audit entry)", async () => {
    const trader = await fixtures.createUser("TRADER");
    const admin = await fixtures.createUser("ADMIN");
    const submission = await createPendingSubmission(trader.id);

    await adminOverrideKycStatus(submission.id, "APPROVED", admin.id);
    await adminOverrideKycStatus(submission.id, "APPROVED", admin.id);

    const logs = await prisma.auditLog.count({
      where: { targetType: "KycSubmission", targetId: submission.id, action: "KYC_ADMIN_OVERRIDE" },
    });
    expect(logs).toBe(1);
  });

  it("can move a submission to any of the three real states, including resetting back to PENDING", async () => {
    const trader = await fixtures.createUser("TRADER");
    const admin = await fixtures.createUser("ADMIN");
    const submission = await createPendingSubmission(trader.id);

    await adminOverrideKycStatus(submission.id, "REJECTED", admin.id, "test");
    const afterReject = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(afterReject.status).toBe("REJECTED");

    await adminOverrideKycStatus(submission.id, "PENDING", admin.id);
    const afterReset = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submission.id } });
    expect(afterReset.status).toBe("PENDING");
    expect(afterReset.reviewerId).toBeNull();
  });
});
