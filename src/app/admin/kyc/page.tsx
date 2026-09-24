import { requireAdminPage } from "@/lib/auth/pageGuards";
import { devOverridesEnabled } from "@/env";
import { KycTable } from "@/components/admin/KycTable";

export const dynamic = "force-dynamic";

export default async function AdminKycPage() {
  await requireAdminPage();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">KYC Verification</h1>
        <p className="text-sm text-muted">Identity verification queue. Provider-verified results arrive by signed webhook; manual submissions are reviewed here.</p>
      </div>
      <KycTable devOverrides={devOverridesEnabled()} />
    </div>
  );
}
