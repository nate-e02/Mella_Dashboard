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

// The route calls activatePurchase() directly - no Chapa network call is
// involved in this admin-only path, so nothing needs mocking there.
const { POST } = await import("@/app/api/admin/purchases/[id]/mark-paid/route");

function sessionUser(overrides: Partial<SessionUser>): SessionUser {
  return { id: "u1", name: "Test", email: "test@example.com", role: "TRADER", status: "ACTIVE", ...overrides };
}

function postRequest() {
  return new NextRequest("http://localhost/api/admin/purchases/x/mark-paid", { method: "POST" });
}

const fixtures = new TestFixtures();

beforeEach(() => getSessionUserMock.mockReset());
afterEach(() => fixtures.cleanup());

describe("POST /api/admin/purchases/[id]/mark-paid - route-level authorization", () => {
  it("rejects an unauthenticated request with 401", async () => {
    getSessionUserMock.mockResolvedValue(null);

    const res = await POST(postRequest(), { params: Promise.resolve({ id: "does-not-matter" }) });

    expect(res.status).toBe(401);
  });

  it("rejects a TRADER with 403 - the temporary test-paid action must never be usable by traders", async () => {
    getSessionUserMock.mockResolvedValue(sessionUser({ role: "TRADER" }));

    const res = await POST(postRequest(), { params: Promise.resolve({ id: "does-not-matter" }) });

    expect(res.status).toBe(403);
  });

  it("allows an ADMIN to mark a real purchase paid, activating it via the shared activation logic", async () => {
    const trader = await fixtures.createUser("TRADER");
    const admin = await fixtures.createUser("ADMIN");
    const template = await fixtures.createTemplate();
    const purchase = await prisma.purchase.create({
      data: {
        userId: trader.id,
        templateId: template.id,
        status: "PENDING",
        amount: template.price,
        currency: "ETB",
        providerTxRef: `vitest-admin-route-${Date.now()}`,
        snapshot: (await import("@/types")).toTemplateSnapshot(template) as never,
      },
    });
    getSessionUserMock.mockResolvedValue(sessionUser({ id: admin.id, role: "ADMIN" }));

    const res = await POST(postRequest(), { params: Promise.resolve({ id: purchase.id }) });

    expect(res.status).toBe(200);
    const updated = await prisma.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
    expect(updated.status).toBe("PAID");
    const account = await prisma.tradingAccount.findUnique({ where: { purchaseId: purchase.id } });
    expect(account).not.toBeNull();
  });
});
