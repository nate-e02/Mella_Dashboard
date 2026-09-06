import "server-only";
import { AuthError } from "@/lib/auth/guards";

/**
 * Asserts that a resource (identified by its owning user id) belongs to the
 * requesting user. Throws a 404 (not a 403) so an authenticated trader
 * probing another trader's account/purchase/trade id by guessing cannot
 * distinguish "doesn't exist" from "exists but isn't yours" - the same
 * convention already used for account lookups elsewhere in the app.
 *
 * Centralizing this one check keeps every trader-scoped route/page (trades,
 * account detail, etc.) consistent instead of re-implementing the same
 * `resource.userId !== user.id` comparison in multiple places.
 */
export function assertOwnsResource(resourceOwnerId: string | null | undefined, requestingUserId: string): void {
  if (!resourceOwnerId || resourceOwnerId !== requestingUserId) {
    throw new AuthError("The requested resource was not found", 404);
  }
}
