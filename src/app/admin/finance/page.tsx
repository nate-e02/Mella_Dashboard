import { requireAdminPage } from "@/lib/auth/pageGuards";
import { FinanceExplorer } from "@/components/admin/FinanceExplorer";

export const dynamic = "force-dynamic";

export default async function AdminFinancePage() {
  const admin = await requireAdminPage();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Finance & Payouts</h1>
        <p className="text-sm text-muted">Revenue (Chapa, ETB) and the payout queue. Payouts need one admin to approve and a different admin to mark them paid.</p>
      </div>
      <FinanceExplorer adminId={admin.id} />
    </div>
  );
}
