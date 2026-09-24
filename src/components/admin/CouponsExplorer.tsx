"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Pagination } from "@/components/ui/Pagination";
import { FilterTabs, SearchInput } from "@/components/ui/Toolbar";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency, formatDateTime } from "@/lib/format";

type Coupon = {
  id: string;
  code: string;
  description: string;
  percentOff: number | null;
  amountOff: number | null;
  currency: string;
  maxRedemptions: number | null;
  perUserLimit: number;
  redeemedCount: number;
  templateIds: string[];
  validFrom: string | null;
  validUntil: string | null;
  active: boolean;
  createdAt: string;
  _count: { purchases: number };
};
type TemplateOption = { id: string; name: string; phase: string };
type Paged<T> = { items: T[]; total: number; page: number; totalPages: number };

const STATUS_TABS = [
  { label: "All", value: "ALL" },
  { label: "Active", value: "ACTIVE" },
  { label: "Inactive", value: "INACTIVE" },
];

/** Where a coupon is in its lifecycle right now (active flag + date window + redemptions). */
function couponState(c: Coupon, now: number): { label: string; tone: "success" | "warning" | "muted" | "danger" } {
  if (!c.active) return { label: "Inactive", tone: "muted" };
  if (c.validFrom && new Date(c.validFrom).getTime() > now) return { label: "Scheduled", tone: "warning" };
  if (c.validUntil && new Date(c.validUntil).getTime() <= now) return { label: "Expired", tone: "danger" };
  if (c.maxRedemptions != null && c.redeemedCount >= c.maxRedemptions) return { label: "Used up", tone: "danger" };
  return { label: "Live", tone: "success" };
}

export function CouponsExplorer() {
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<Coupon>>({ items: [], total: 0, page: 1, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [editing, setEditing] = useState<Coupon | "new" | null>(null);
  const [now] = useState(() => Date.now());
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status, search, page: String(page), pageSize: "20" });
      const res = await fetch(`/api/admin/coupons?${params.toString()}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load coupons");
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load coupons");
    } finally {
      setLoading(false);
    }
  }, [status, search, page]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    fetch("/api/admin/templates/options")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: TemplateOption[]) => setTemplates(rows.filter((t) => t.phase === "PHASE_1")))
      .catch(() => undefined);
  }, []);

  const templateName = (id: string) => templates.find((t) => t.id === id)?.name ?? "Unknown template";

  async function toggleActive(c: Coupon) {
    const res = await fetch(`/api/admin/coupons/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !c.active }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast.push(body.error || "Failed to update coupon", "error");
    toast.push(`${c.code} ${c.active ? "deactivated" : "activated"}`, "success");
    load();
  }

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <FilterTabs
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={STATUS_TABS}
          />
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search code or description..."
          />
        </div>
        <button className="btn-primary !py-1.5 text-xs" onClick={() => setEditing("new")}>
          + New coupon
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">Code</th>
              <th className="px-4 py-2.5">Discount</th>
              <th className="px-4 py-2.5">Redemptions</th>
              <th className="px-4 py-2.5">Per user</th>
              <th className="px-4 py-2.5">Valid</th>
              <th className="px-4 py-2.5">Applies to</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-danger">
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && data.items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted">
                  No coupons in this view.
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              data.items.map((c) => {
                const state = couponState(c, now);
                return (
                  <tr key={c.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-mono font-semibold">{c.code}</div>
                      {c.description && <div className="max-w-[220px] truncate text-xs text-muted">{c.description}</div>}
                    </td>
                    <td className="px-4 py-2.5 font-medium">{c.percentOff != null ? `${c.percentOff}%` : formatCurrency(c.amountOff ?? 0, c.currency)}</td>
                    <td className="px-4 py-2.5">
                      {c.redeemedCount}
                      {c.maxRedemptions != null ? ` / ${c.maxRedemptions}` : " / ∞"}
                      {c._count.purchases > c.redeemedCount && <div className="text-[10px] text-muted">{c._count.purchases} checkouts</div>}
                    </td>
                    <td className="px-4 py-2.5">{c.perUserLimit}</td>
                    <td className="px-4 py-2.5 text-xs">
                      <div>{c.validFrom ? formatDateTime(c.validFrom) : "Any time"}</div>
                      <div className="text-muted">→ {c.validUntil ? formatDateTime(c.validUntil) : "no end"}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {c.templateIds.length === 0 ? (
                        <span className="text-muted">All challenges</span>
                      ) : (
                        <div className="max-w-[220px]" title={c.templateIds.map(templateName).join(", ")}>
                          {c.templateIds.length === 1 ? templateName(c.templateIds[0]) : `${c.templateIds.length} challenges`}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={state.tone}>{state.label}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1.5">
                        <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setEditing(c)}>
                          Edit
                        </button>
                        <button className={`btn-ghost !px-2 !py-1 text-xs ${c.active ? "text-danger" : "text-success"}`} onClick={() => toggleActive(c)}>
                          {c.active ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />

      {editing && (
        <CouponModal
          coupon={editing === "new" ? null : editing}
          templates={templates}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

/** ISO string -> value for <input type="datetime-local"> in the admin's local time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CouponModal({ coupon, templates, onClose, onSaved }: { coupon: Coupon | null; templates: TemplateOption[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const codeLocked = !!coupon && (coupon.redeemedCount > 0 || coupon._count.purchases > 0);
  const [form, setForm] = useState(() => ({
    code: coupon?.code ?? "",
    description: coupon?.description ?? "",
    kind: coupon?.amountOff != null ? "AMOUNT" : "PERCENT",
    value: coupon ? String(coupon.percentOff ?? coupon.amountOff ?? "") : "",
    maxRedemptions: coupon?.maxRedemptions != null ? String(coupon.maxRedemptions) : "",
    perUserLimit: String(coupon?.perUserLimit ?? 1),
    validFrom: toLocalInput(coupon?.validFrom ?? null),
    validUntil: toLocalInput(coupon?.validUntil ?? null),
    templateIds: coupon?.templateIds ?? [],
    active: coupon?.active ?? true,
  }));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const value = Number(form.value);
      const payload = {
        ...(codeLocked ? {} : { code: form.code.trim().toUpperCase() }),
        description: form.description,
        percentOff: form.kind === "PERCENT" ? value : null,
        amountOff: form.kind === "AMOUNT" ? value : null,
        maxRedemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
        perUserLimit: Number(form.perUserLimit || 1),
        validFrom: form.validFrom ? new Date(form.validFrom).toISOString() : null,
        validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : null,
        templateIds: form.templateIds,
        active: form.active,
      };
      const res = await fetch(coupon ? `/api/admin/coupons/${coupon.id}` : "/api/admin/coupons", {
        method: coupon ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.issues?.[0] ? `${body.issues[0].path}: ${body.issues[0].message}` : body.error || "Failed to save coupon");
      toast.push(coupon ? "Coupon updated" : "Coupon created", "success");
      onSaved();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Failed to save coupon", "error");
    } finally {
      setSaving(false);
    }
  }

  function toggleTemplate(id: string) {
    set("templateIds", form.templateIds.includes(id) ? form.templateIds.filter((t) => t !== id) : [...form.templateIds, id]);
  }

  return (
    <Modal open onClose={onClose} title={coupon ? `Edit ${coupon.code}` : "New coupon"} widthClass="max-w-2xl">
      <form onSubmit={submit} className="flex flex-col gap-4 text-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-medium">Code</span>
            <input
              className="input-base font-mono uppercase"
              value={form.code}
              onChange={(e) => set("code", e.target.value)}
              pattern="[A-Za-z0-9_\-]{3,32}"
              title="3–32 letters, digits, - or _"
              required
              disabled={codeLocked}
            />
            {codeLocked && <span className="text-xs text-muted">Locked: this coupon has already been used.</span>}
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Description (internal)</span>
            <input className="input-base" value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={300} placeholder="e.g. Telegram launch campaign" />
          </label>
        </div>

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <legend className="mb-1 font-medium">Discount</legend>
          <div className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1">
            {(["PERCENT", "AMOUNT"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => set("kind", k)}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${form.kind === k ? "bg-accent-2/20 text-accent-2" : "text-muted hover:text-foreground"}`}
              >
                {k === "PERCENT" ? "Percent off" : "Fixed ETB off"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2">
            <input
              type="number"
              className="input-base"
              min={0.01}
              max={form.kind === "PERCENT" ? 100 : undefined}
              step="0.01"
              value={form.value}
              onChange={(e) => set("value", e.target.value)}
              required
              aria-label={form.kind === "PERCENT" ? "Percent off" : "ETB off"}
            />
            <span className="shrink-0 text-muted">{form.kind === "PERCENT" ? "%" : "ETB"}</span>
          </label>
        </fieldset>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-medium">Max redemptions (total)</span>
            <input type="number" min={1} step={1} className="input-base" value={form.maxRedemptions} onChange={(e) => set("maxRedemptions", e.target.value)} placeholder="Unlimited" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Per-user limit</span>
            <input type="number" min={1} max={100} step={1} className="input-base" value={form.perUserLimit} onChange={(e) => set("perUserLimit", e.target.value)} required />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Valid from</span>
            <input type="datetime-local" className="input-base" value={form.validFrom} onChange={(e) => set("validFrom", e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Valid until</span>
            <input type="datetime-local" className="input-base" value={form.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
          </label>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 font-medium">Applies to</legend>
          <p className="text-xs text-muted">Leave all unticked to allow every Phase 1 challenge.</p>
          <div className="grid max-h-44 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-border bg-surface-2 p-2 sm:grid-cols-2">
            {templates.length === 0 && <span className="text-xs text-muted">No Phase 1 templates.</span>}
            {templates.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-xs">
                <input type="checkbox" className="accent-accent-2" checked={form.templateIds.includes(t.id)} onChange={() => toggleTemplate(t.id)} />
                <span className="truncate">{t.name}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-accent-2" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
          <span>Active</span>
        </label>

        <div className="mt-2 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving..." : coupon ? "Save changes" : "Create coupon"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
