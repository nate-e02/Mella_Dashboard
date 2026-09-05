import { notFound } from "next/navigation";
import { getTemplateById } from "@/lib/services/templates";
import { TemplateForm } from "@/components/admin/TemplateForm";

export const dynamic = "force-dynamic";

export default async function EditTemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const { view } = await searchParams;
  const template = await getTemplateById(id);
  if (!template) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{view ? "View Template" : "Edit Template"}</h1>
        <p className="text-sm text-muted">{template.name}</p>
      </div>
      <TemplateForm template={template} readOnly={!!view} />
    </div>
  );
}
