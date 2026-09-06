import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/session";

const getSessionUserMock = vi.fn<() => Promise<SessionUser | null>>();

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: () => getSessionUserMock(),
}));

// Imported after the mock is registered so guards.ts picks up the mocked module.
const { requireUser, requireAdmin, requireTrader, AuthError } = await import("@/lib/auth/guards");

function user(overrides: Partial<SessionUser> = {}): SessionUser {
  return { id: "u1", name: "Test", email: "test@example.com", role: "TRADER", status: "ACTIVE", ...overrides };
}

describe("requireUser", () => {
  beforeEach(() => getSessionUserMock.mockReset());

  it("returns the session user when authenticated", async () => {
    getSessionUserMock.mockResolvedValue(user());
    await expect(requireUser()).resolves.toMatchObject({ id: "u1" });
  });

  it("throws a 401 AuthError when there is no session", async () => {
    getSessionUserMock.mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow(AuthError);
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  });
});

describe("requireAdmin", () => {
  beforeEach(() => getSessionUserMock.mockReset());

  it("allows an ADMIN through", async () => {
    getSessionUserMock.mockResolvedValue(user({ role: "ADMIN" }));
    await expect(requireAdmin()).resolves.toMatchObject({ role: "ADMIN" });
  });

  it("throws a 403 AuthError for a TRADER", async () => {
    getSessionUserMock.mockResolvedValue(user({ role: "TRADER" }));
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
  });

  it("throws a 401 AuthError when there is no session at all", async () => {
    getSessionUserMock.mockResolvedValue(null);
    await expect(requireAdmin()).rejects.toMatchObject({ status: 401 });
  });
});

describe("requireTrader", () => {
  beforeEach(() => getSessionUserMock.mockReset());

  it("allows a TRADER through", async () => {
    getSessionUserMock.mockResolvedValue(user({ role: "TRADER" }));
    await expect(requireTrader()).resolves.toMatchObject({ role: "TRADER" });
  });

  it("throws a 403 AuthError for an ADMIN calling a trader-only route", async () => {
    getSessionUserMock.mockResolvedValue(user({ role: "ADMIN" }));
    await expect(requireTrader()).rejects.toMatchObject({ status: 403 });
  });
});
