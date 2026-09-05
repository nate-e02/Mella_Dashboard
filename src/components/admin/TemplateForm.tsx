"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Template } from "@prisma/client";
import { useToast } from "@/components/ui/Toast";

type TemplateOption = { id: string; name: string; phase: string };

type FormState = {
  name: string;
  description: string;
  price: string;
  currency: string;
  status: string;
  phase: string;
  programType: string;
  groupName: string;
  groupKey: string;
  startingBalance: string;
  accountSize: string;
  leverage: string;
  accountCurrency: string;
  profitTarget: string;
  profitSplit: string;
  maxDrawdown: string;
  dailyDrawdown: string;
  minTradingDays: string;
  maxTradingDays: string;
  maxPositionSize: string;
  maxPositions: string;
  durationDays: string;
  passingRequirements: string;
  failingRequirements: string;
  weekendHoldingAllowed: boolean;
  overnightHoldingAllowed: boolean;
  newsTradingAllowed: boolean;
  stopLossRequired: boolean;
  dailyLossResetTime: string;
  consistencyRequirement: string;
  nextPhaseId: string;
};

function toFormState(t?: Template | null): FormState {
  return {
    name: t?.name ?? "",
    description: t?.description ?? "",
    price: t?.price?.toString() ?? "49",
    currency: t?.currency ?? "USD",
    status: t?.status ?? "DRAFT",
    phase: t?.phase ?? "PHASE_1",
    programType: t?.programType ?? "STANDARD",
    groupName: t?.groupName ?? "",
    groupKey: t?.groupKey ?? "",
    startingBalance: t?.startingBalance?.toString() ?? "10000",
    accountSize: t?.accountSize?.toString() ?? "10000",
    leverage: t?.leverage?.toString() ?? "100",
    accountCurrency: t?.accountCurrency ?? "USD",
    profitTarget: t?.profitTarget?.toString() ?? "8",
    profitSplit: t?.profitSplit?.toString() ?? "80",
    maxDrawdown: t?.maxDrawdown?.toString() ?? "10",
    dailyDrawdown: t?.dailyDrawdown?.toString() ?? "5",
    minTradingDays: t?.minTradingDays?.toString() ?? "0",
    maxTradingDays: t?.maxTradingDays?.toString() ?? "",
    maxPositionSize: t?.maxPositionSize?.toString() ?? "",
    maxPositions: t?.maxPositions?.toString() ?? "",
    durationDays: t?.durationDays?.toString() ?? "30",
    passingRequirements: t?.passingRequirements ?? "",
    failingRequirements: t?.failingRequirements ?? "",
    weekendHoldingAllowed: t?.weekendHoldingAllowed ?? true,
    overnightHoldingAllowed: t?.overnightHoldingAllowed ?? true,
    newsTradingAllowed: t?.newsTradingAllowed ?? true,
    stopLossRequired: t?.stopLossRequired ?? false,
    dailyLossResetTime: t?.dailyLossResetTime ?? "00:00 UTC",
    consistencyRequirement: t?.consistencyRequirement?.toString() ?? "",
    nextPhaseId: t?.nextPhaseId ?? "",
  };
}

function numOrUndefined(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

export function TemplateForm({ template, readOnly }: { template?: Template | null; readOnly?: boolean }) {
  const [form, setForm] = useState<FormState>(toFormState(template));
  const [options, setOptions] = useState<TemplateOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const router = useRouter();
  const toast = useToast();
  const isEdit = !!template;

  useEffect(() => {
    fetch("/api/admin/templates/options")
      .then((r) => r.json())
      .then((data) => setOptions(data.filter((o: TemplateOption) => o.id !== template?.id)))
      .catch(() => undefined);
  }, [template?.id]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setSaving(true);

    const payload = {
      name: form.name,
      description: form.description,
      price: Number(form.price),
      currency: form.currency,
      status: form.status,
      phase: form.phase,
      programType: form.programType,
      groupName: form.groupName,
      groupKey: form.groupKey || form.groupName.toLowerCase().replace(/\s+/g, "-"),
      startingBalance: Number(form.startingBalance),
      accountSize: Number(form.accountSize),
      leverage: Number(form.leverage),
      accountCurrency: form.accountCurrency,
      profitTarget: numOrUndefined(form.profitTarget) ?? null,
      profitSplit: Number(form.profitSplit),
      maxDrawdown: Number(form.maxDrawdown),
      dailyDrawdown: Number(form.dailyDrawdown),
      minTradingDays: Number(form.minTradingDays || 0),
      maxTradingDays: numOrUndefined(form.maxTradingDays) ?? null,
      maxPositionSize: numOrUndefined(form.maxPositionSize) ?? null,
      maxPositions: numOrUndefined(form.maxPositions) ?? null,
      durationDays: numOrUndefined(form.durationDays) ?? null,
      passingRequirements: form.passingRequirements,
      failingRequirements: form.failingRequirements,
      weekendHoldingAllowed: form.weekendHoldingAllowed,
      overnightHoldingAllowed: form.overnightHoldingAllowed,
      newsTradingAllowed: form.newsTradingAllowed,
      stopLossRequired: form.stopLossRequired,
      dailyLossResetTime: form.dailyLossResetTime,
      consistencyRequirement: numOrUndefined(form.consistencyRequirement) ?? null,
      nextPhaseId: form.nextPhaseId || null,
    };

    try {
      const res = await fetch(isEdit ? `/api/admin/templates/${template!.id}` : "/api/admin/templates", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.issues) setErrors(body.issues.map((i: { message: string }) => i.message));
        else setErrors([body.error || "Failed to save template"]);
        toast.push("Please fix the errors below", "error");
        return;
      }
      toast.push(isEdit ? "Template updated" : "Template created", "success");
      router.push("/admin/templates");
      router.refresh();
    } catch {
      setErrors(["Unexpected error, please try again"]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <fieldset disabled={readOnly} className="contents">
        {errors.length > 0 && (
          <div className="card border-danger/40 p-4 text-sm text-danger">
            <ul className="list-inside list-disc">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        <Section title="General">
          <Field label="Template Name" required>
            <input className="input-base" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </Field>
          <Field label="Description">
            <textarea className="input-base" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Price">
              <input type="number" min={0} step="0.01" className="input-base" value={form.price} onChange={(e) => set("price", e.target.value)} />
            </Field>
            <Field label="Currency">
              <input className="input-base" value={form.currency} onChange={(e) => set("currency", e.target.value)} />
            </Field>
            <Field label="Status">
              <select className="input-base" value={form.status} onChange={(e) => set("status", e.target.value)}>
                <option value="DRAFT">Draft</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </Field>
            <Field label="Phase">
              <select className="input-base" value={form.phase} onChange={(e) => set("phase", e.target.value)}>
                <option value="PHASE_1">Phase 1</option>
                <option value="PHASE_2">Phase 2</option>
                <option value="FUNDED">Funded</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Program Type">
              <select className="input-base" value={form.programType} onChange={(e) => set("programType", e.target.value)}>
                <option value="STANDARD">Standard</option>
                <option value="SWING_TRADER">Swing Trader</option>
                <option value="AGGRESSIVE">Aggressive</option>
                <option value="INSTANT_FUNDING">Instant Funding</option>
                <option value="CONSISTENCY">Consistency</option>
                <option value="ELITE">Elite</option>
                <option value="CRYPTO">Crypto</option>
              </select>
            </Field>
            <Field label="Group Name" required hint="Groups phases of the same program, e.g. 'Standard'">
              <input className="input-base" value={form.groupName} onChange={(e) => set("groupName", e.target.value)} required />
            </Field>
            <Field label="Group Key" hint="Auto-generated from group name if left blank">
              <input className="input-base" value={form.groupKey} onChange={(e) => set("groupKey", e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title="Account">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Starting Balance">
              <input type="number" min={0} className="input-base" value={form.startingBalance} onChange={(e) => set("startingBalance", e.target.value)} />
            </Field>
            <Field label="Account Size">
              <input type="number" min={0} className="input-base" value={form.accountSize} onChange={(e) => set("accountSize", e.target.value)} />
            </Field>
            <Field label="Leverage (1:x)">
              <input type="number" min={1} className="input-base" value={form.leverage} onChange={(e) => set("leverage", e.target.value)} />
            </Field>
            <Field label="Account Currency">
              <input className="input-base" value={form.accountCurrency} onChange={(e) => set("accountCurrency", e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title="Challenge Rules">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Profit Target (%)" hint="Leave blank for funded accounts">
              <input type="number" min={0} className="input-base" value={form.profitTarget} onChange={(e) => set("profitTarget", e.target.value)} />
            </Field>
            <Field label="Profit Split (%)">
              <input type="number" min={0} max={100} className="input-base" value={form.profitSplit} onChange={(e) => set("profitSplit", e.target.value)} />
            </Field>
            <Field label="Max Drawdown (%)">
              <input type="number" min={0} className="input-base" value={form.maxDrawdown} onChange={(e) => set("maxDrawdown", e.target.value)} />
            </Field>
            <Field label="Daily Drawdown (%)">
              <input type="number" min={0} className="input-base" value={form.dailyDrawdown} onChange={(e) => set("dailyDrawdown", e.target.value)} />
            </Field>
            <Field label="Min Trading Days">
              <input type="number" min={0} className="input-base" value={form.minTradingDays} onChange={(e) => set("minTradingDays", e.target.value)} />
            </Field>
            <Field label="Max Trading Days">
              <input type="number" min={0} className="input-base" value={form.maxTradingDays} onChange={(e) => set("maxTradingDays", e.target.value)} />
            </Field>
            <Field label="Max Position Size">
              <input type="number" min={0} className="input-base" value={form.maxPositionSize} onChange={(e) => set("maxPositionSize", e.target.value)} />
            </Field>
            <Field label="Max Positions">
              <input type="number" min={0} className="input-base" value={form.maxPositions} onChange={(e) => set("maxPositions", e.target.value)} />
            </Field>
            <Field label="Duration (days)" hint="Blank = unlimited">
              <input type="number" min={0} className="input-base" value={form.durationDays} onChange={(e) => set("durationDays", e.target.value)} />
            </Field>
            <Field label="Next Phase">
              <select className="input-base" value={form.nextPhaseId} onChange={(e) => set("nextPhaseId", e.target.value)}>
                <option value="">Final (no next phase)</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Passing Requirements">
            <textarea className="input-base" rows={2} value={form.passingRequirements} onChange={(e) => set("passingRequirements", e.target.value)} />
          </Field>
          <Field label="Failing Requirements">
            <textarea className="input-base" rows={2} value={form.failingRequirements} onChange={(e) => set("failingRequirements", e.target.value)} />
          </Field>
        </Section>

        <Section title="Other Rules">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Toggle label="Weekend Holding" checked={form.weekendHoldingAllowed} onChange={(v) => set("weekendHoldingAllowed", v)} />
            <Toggle label="Overnight Holding" checked={form.overnightHoldingAllowed} onChange={(v) => set("overnightHoldingAllowed", v)} />
            <Toggle label="News Trading" checked={form.newsTradingAllowed} onChange={(v) => set("newsTradingAllowed", v)} />
            <Toggle label="Stop Loss Required" checked={form.stopLossRequired} onChange={(v) => set("stopLossRequired", v)} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Daily Loss Reset Time">
              <input className="input-base" value={form.dailyLossResetTime} onChange={(e) => set("dailyLossResetTime", e.target.value)} />
            </Field>
            <Field label="Consistency Requirement (%)">
              <input type="number" min={0} max={100} className="input-base" value={form.consistencyRequirement} onChange={(e) => set("consistencyRequirement", e.target.value)} />
            </Field>
          </div>
        </Section>
      </fieldset>

      {!readOnly && (
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => router.push("/admin/templates")}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Template"}
          </button>
        </div>
      )}
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card flex flex-col gap-4 p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-foreground">
        {label} {required && <span className="text-danger">*</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-accent-2" />
    </label>
  );
}
