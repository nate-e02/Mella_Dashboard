import { describe, expect, it } from "vitest";
import { assertOwnsResource } from "@/lib/auth/ownership";
import { AuthError } from "@/lib/auth/guards";

describe("assertOwnsResource", () => {
  it("does not throw when the resource belongs to the requesting user", () => {
    expect(() => assertOwnsResource("user-1", "user-1")).not.toThrow();
  });

  it("throws a 404 AuthError when the resource belongs to someone else (IDOR guard)", () => {
    try {
      assertOwnsResource("user-2", "user-1");
      throw new Error("expected assertOwnsResource to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).status).toBe(404);
    }
  });

  it("throws a 404 (not found), never a 403, so existence of another user's resource is never leaked", () => {
    try {
      assertOwnsResource("user-2", "user-1");
    } catch (err) {
      expect((err as AuthError).status).not.toBe(403);
    }
  });

  it("throws when the resource has no owner at all (e.g. the lookup returned nothing)", () => {
    expect(() => assertOwnsResource(null, "user-1")).toThrow(AuthError);
    expect(() => assertOwnsResource(undefined, "user-1")).toThrow(AuthError);
  });
});
