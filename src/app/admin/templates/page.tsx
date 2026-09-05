import Link from "next/link";
import { getTemplateStats } from "@/lib/services/templates";
import { StatCard } from "@/components/ui/Card";
import { TemplatesExplorer } from "@/components/admin/TemplatesExplorer";

export const dynamic = "force-dynamic";

export default async function AdminTemplatesPage() {
  const stats = await getTemplateStats();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold">Challenge Templates</h1>
          <p className="text-sm text-muted">Design evaluation phases, configure risk rules, and define the trader journey from challenge to funded.</p>
        </div>
        <Link href="/admin/templates/new" className="btn-primary">
          + New Template
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total Templates" value={stats.total} />
        <StatCard label="Active" value={stats.active} tone="success" />
        <StatCard label="Programs" value={stats.programs} />
        <StatCard label="Phase 1" value={stats.phase1} />
        <StatCard label="Phase 2" value={stats.phase2} />
        <StatCard label="Funded" value={stats.funded} tone="success" />
      </div>

      <TemplatesExplorer />
    </div>
  );
}
