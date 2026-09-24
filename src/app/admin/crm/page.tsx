import { requireAdminPage } from "@/lib/auth/pageGuards";
import { devOverridesEnabled } from "@/env";
import { CrmExplorer } from "@/components/admin/CrmExplorer";

export const dynamic = "force-dynamic";

export default async function AdminCrmPage() {
  await requireAdminPage();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">CRM</h1>
        <p className="text-sm text-muted">Track leads through your funnel and manage purchase records.</p>
      </div>
      <CrmExplorer devOverrides={devOverridesEnabled()} />
    </div>
  );
}
