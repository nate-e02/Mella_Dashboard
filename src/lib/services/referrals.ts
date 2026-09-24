import "server-only";

/** Cookie set by /r/[code] and read at sign-up (email or phone) to credit the referrer. */
export const REFERRAL_COOKIE = "mella_ref";

/**
 * Links a newly created user to the owner of `code` (case-insensitive).
 * No-op for an empty/unknown code or a self-referral. Never throws: a bad
 * referral code must not break sign-up.
 *
 * TODO(growth): implemented by the referrals feature.
 */
export async function attachReferral(newUserId: string, code: string | null | undefined): Promise<void> {
  void newUserId;
  void code;
}
