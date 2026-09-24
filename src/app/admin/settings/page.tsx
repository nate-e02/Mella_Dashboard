import { getSessionUser } from "@/lib/auth/session";
import { adminMfaRequired } from "@/lib/auth/guards";
import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/shared/ChangePasswordForm";
import { MfaSettings } from "@/components/shared/MfaSettings";
import { FxRateCard } from "@/components/admin/settings/FxRateCard";
import { getUsdEtbRate } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

/**
 * Deliberately NOT gated by requireAdminPage: an admin who has not yet set up
 * MFA must be able to reach this page to enrol. Role is still enforced.
 */
export default async function AdminSettingsPage({ searchParams }: { searchParams: Promise<{ mfa?: string }> }) {
  const [user, { mfa }] = await Promise.all([getSessionUser(), searchParams]);
  if (!user) redirect("/login?next=/admin/settings");
  if (user.role !== "ADMIN") redirect("/dashboard");
  const fx = await getUsdEtbRate();
  const mfaRequired = adminMfaRequired();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings & security</h1>
        <p className="text-sm text-muted">Your admin credentials and platform-wide configuration.</p>
      </div>

      {mfa === "required" && !user.mfaEnabled && (
        <div role="alert" className="card border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Two-factor authentication is required for admin access. Set it up below to unlock the admin console.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card max-w-md p-5">
          <h3 className="mb-3 text-sm font-semibold">Profile</h3>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted">Name</dt>
            <dd className="text-right font-medium">{user.name}</dd>
            <dt className="text-muted">Email</dt>
            <dd className="text-right font-medium">{user.email}</dd>
            <dt className="text-muted">Role</dt>
            <dd className="text-right font-medium">{user.role}</dd>
          </dl>
        </div>
        <MfaSettings enabled={user.mfaEnabled} required={mfaRequired} />
        <ChangePasswordForm />
        {user.mfaEnabled || !mfaRequired ? <FxRateCard current={fx ? { rate: fx.rate, source: fx.source, effectiveAt: fx.effectiveAt.toISOString() } : null} /> : null}
      </div>
    </div>
  );
}
