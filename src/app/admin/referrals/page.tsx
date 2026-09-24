import { requireAdminPage } from "@/lib/auth/pageGuards";
import { ReferralsExplorer } from "@/components/admin/ReferralsExplorer";

export const dynamic = "force-dynamic";

export default async function AdminReferralsPage() {
  const admin = await requireAdminPage();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Referrals</h1>
        <p className="text-sm text-muted">
          Referral rewards are created automatically when a referred trader&apos;s purchase is paid. One admin approves a reward and a different admin marks it paid after sending the telebirr transfer.
        </p>
      </div>
      <ReferralsExplorer adminId={admin.id} />
    </div>
  );
}
