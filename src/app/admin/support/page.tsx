import { requireAdminPage } from "@/lib/auth/pageGuards";
import { SupportExplorer } from "@/components/admin/SupportExplorer";

export const dynamic = "force-dynamic";

export default async function AdminSupportPage() {
  await requireAdminPage();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Support</h1>
        <p className="text-sm text-muted">Trader tickets. Replies are shown on the trader&apos;s Account page and trigger a notification.</p>
      </div>
      <SupportExplorer />
    </div>
  );
}
