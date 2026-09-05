import { CrmExplorer } from "@/components/admin/CrmExplorer";

export default function AdminCrmPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">CRM</h1>
        <p className="text-sm text-muted">Track leads through your funnel and manage purchase records.</p>
      </div>
      <CrmExplorer />
    </div>
  );
}
