import "server-only";
import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import { adminMfaRequired } from "@/lib/auth/guards";

/**
 * Page-level guards (defense in depth beyond the route-group layouts). They
 * redirect instead of throwing so they can be the first line of any page.
 * Kept separate from guards.ts because `next/navigation` cannot be loaded by
 * the trading worker, which imports the services that use guards.ts errors.
 */
export async function requireAdminPage(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "ADMIN") redirect("/dashboard");
  if (adminMfaRequired() && !user.mfaEnabled) redirect("/admin/settings?mfa=required");
  return user;
}

export async function requireTraderPage(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "TRADER") redirect("/admin");
  return user;
}
