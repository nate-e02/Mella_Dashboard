import { requireAdminPage } from "@/lib/auth/pageGuards";
import { TemplateForm } from "@/components/admin/TemplateForm";

export default async function NewTemplatePage() {
  await requireAdminPage();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">New Template</h1>
        <p className="text-sm text-muted">Configure a new challenge/program product.</p>
      </div>
      <TemplateForm />
    </div>
  );
}
