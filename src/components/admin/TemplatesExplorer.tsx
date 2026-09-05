"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Template } from "@prisma/client";
import { SearchInput, FilterSelect } from "@/components/ui/Toolbar";
import { StatusBadge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency } from "@/lib/format";

type TemplateRow = Template & { nextPhase: { id: string; name: string } | null };

const STATUS_OPTIONS = [
  { label: "All Statuses", value: "ALL" },
  { label: "Draft", value: "DRAFT" },
  { label: "Active", value: "ACTIVE" },
  { label: "Inactive", value: "INACTIVE" },
  { label: "Archived", value: "ARCHIVED" },
];

const PHASE_OPTIONS = [
  { label: "All Phases", value: "ALL" },
  { label: "Phase 1", value: "PHASE_1" },
  { label: "Phase 2", value: "PHASE_2" },
  { label: "Funded", value: "FUNDED" },
];

const PHASE_LABEL: Record<string, string> = { PHASE_1: "Phase 1", PHASE_2: "Phase 2", FUNDED: "Funded" };

export function TemplatesExplorer() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [phase, setPhase] = useState("ALL");
  const [items, setItems] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<TemplateRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ search, status, phase });
      const res = await fetch(`/api/admin/templates?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load templates");
      const json = await res.json();
      setItems(json.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, phase]);

  const groups = useMemo(() => {
    const map = new Map<string, { groupName: string; items: TemplateRow[] }>();
    for (const item of items) {
      const existing = map.get(item.groupKey);
      if (existing) existing.items.push(item);
      else map.set(item.groupKey, { groupName: item.groupName, items: [item] });
    }
    return Array.from(map.values());
  }, [items]);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/templates/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete template");
      const json = await res.json();
      toast.push(
        json.mode === "deleted" ? "Template permanently deleted." : "Template archived (referenced by existing purchases/accounts).",
        "success",
      );
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Failed to delete template", "error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={setSearch} placeholder="Search templates..." />
        <FilterSelect value={phase} onChange={setPhase} options={PHASE_OPTIONS} />
        <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </div>

      {loading && <div className="card p-8 text-center text-sm text-muted">Loading templates...</div>}
      {!loading && error && <div className="card p-8 text-center text-sm text-danger">{error}</div>}
      {!loading && !error && groups.length === 0 && (
        <div className="card p-10 text-center">
          <div className="text-sm font-medium">No templates found.</div>
          <div className="mt-1 text-xs text-muted">Try adjusting your search or filters, or create a new template.</div>
        </div>
      )}

      {!loading &&
        !error &&
        groups.map((group) => (
          <div key={group.groupName} className="card overflow-hidden !p-0">
            <button
              onClick={() => setCollapsed((c) => ({ ...c, [group.groupName]: !c[group.groupName] }))}
              className="flex w-full items-center justify-between px-5 py-4"
            >
              <div className="flex items-center gap-3">
                <span className={`transition ${collapsed[group.groupName] ? "-rotate-90" : ""}`}>▾</span>
                <span className="font-semibold">{group.groupName}</span>
                <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs text-muted">
                  {group.items.length} templates
                </span>
              </div>
            </button>

            {!collapsed[group.groupName] && (
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full min-w-[900px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-4 py-2.5 font-medium">Template</th>
                      <th className="px-4 py-2.5 font-medium">Phase</th>
                      <th className="px-4 py-2.5 font-medium">Balance</th>
                      <th className="px-4 py-2.5 font-medium">Leverage</th>
                      <th className="px-4 py-2.5 font-medium">Rules</th>
                      <th className="px-4 py-2.5 font-medium">Duration</th>
                      <th className="px-4 py-2.5 font-medium">Next Phase</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((t) => (
                      <tr key={t.id} className="border-b border-border/60 last:border-0 hover:bg-white/[0.03]">
                        <td className="px-4 py-3">
                          <div className="font-medium">{t.name}</div>
                          <div className="max-w-xs truncate text-xs text-muted">{t.description}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium">{PHASE_LABEL[t.phase]}</span>
                        </td>
                        <td className="px-4 py-3">{formatCurrency(t.accountSize, t.accountCurrency)}</td>
                        <td className="px-4 py-3">1:{t.leverage}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {t.profitTarget != null && <RulePill>Profit target {t.profitTarget}%</RulePill>}
                            <RulePill>Max daily loss {t.dailyDrawdown}%</RulePill>
                            <RulePill>Max overall loss {t.maxDrawdown}%</RulePill>
                          </div>
                        </td>
                        <td className="px-4 py-3">{t.durationDays ? `${t.durationDays}d` : "Unlimited"}</td>
                        <td className="px-4 py-3 text-muted">{t.nextPhase ? t.nextPhase.name : "Final"}</td>
                        <td className="px-4 py-3">
                          <StatusBadge status={t.status} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1.5">
                            <Link href={`/admin/templates/${t.id}/edit?view=1`} className="btn-ghost !px-2 !py-1 text-xs">
                              View
                            </Link>
                            <Link href={`/admin/templates/${t.id}/edit`} className="btn-ghost !px-2 !py-1 text-xs">
                              Edit
                            </Link>
                            <button onClick={() => setDeleteTarget(t)} className="btn-ghost !px-2 !py-1 text-xs text-danger">
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete template?"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? If it has existing purchases or accounts it will be archived instead of deleted to preserve historical data.`}
        confirmLabel="Delete"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function RulePill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[10px] text-muted">{children}</span>;
}
