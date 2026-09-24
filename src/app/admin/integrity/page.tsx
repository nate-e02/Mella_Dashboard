import { requireAdminPage } from "@/lib/auth/pageGuards";
import { AuditExplorer } from "@/components/admin/AuditExplorer";

export const dynamic = "force-dynamic";

export default async function AdminIntegrityPage() {
  await requireAdminPage();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <p className="text-sm text-muted">Every login, status change, payment, payout, KYC decision and configuration change, with who did it and from where.</p>
      </div>
      <AuditExplorer />
    </div>
  );
}
