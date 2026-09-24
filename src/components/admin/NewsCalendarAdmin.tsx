"use client";

import { useState } from "react";
import { useServerTable } from "@/lib/hooks/useServerTable";
import { FilterTabs } from "@/components/ui/Toolbar";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";

type EconomicEvent = { id: string; title: string; currency: string; impact: "LOW" | "MEDIUM" | "HIGH"; scheduledAt: string; source: string };

const SCOPES = [
  { label: "Upcoming", value: "upcoming" },
  { label: "Past", value: "past" },
];
const IMPACT_TONE = { HIGH: "danger", MEDIUM: "warning", LOW: "muted" } as const;
const CSV_EXAMPLE = "title,currency,impact,datetime\nNon-Farm Payrolls,USD,HIGH,2026-10-02T08:30:00-04:00\nECB Rate Decision,EUR,HIGH,2026-10-29T14:15:00+01:00";

async function post(body: unknown) {
  const res = await fetch("/api/admin/news", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.issues?.[0]?.message ? `${json.error}: ${json.issues[0].message}` : json.error || "Request failed");
  return json;
}

export function NewsCalendarAdmin() {
  const [scope, setScope] = useState("upcoming");
  const { setPage, data, loading, error, refetch } = useServerTable<EconomicEvent>("/api/admin/news", { scope });
  const windowMinutes = (data as unknown as { windowMinutes?: number }).windowMinutes;
  const [deleting, setDeleting] = useState<EconomicEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/news/${deleting.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Delete failed");
      toast.push("Event deleted", "success");
      setDeleting(null);
      void refetch();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Delete failed", "error");
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<EconomicEvent>[] = [
    { key: "when", header: "Time (EAT)", render: (r) => <span className="whitespace-nowrap">{formatDateTime(r.scheduledAt)}</span> },
    { key: "currency", header: "Currency", render: (r) => <span className="font-mono font-semibold">{r.currency}</span> },
    { key: "impact", header: "Impact", render: (r) => <Badge tone={IMPACT_TONE[r.impact]}>{r.impact}</Badge> },
    { key: "title", header: "Event", render: (r) => <span className="font-medium">{r.title}</span> },
    { key: "source", header: "Source", render: (r) => <span className="text-xs text-muted">{r.source}</span> },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <button className="btn-ghost !px-2 !py-1 text-xs text-danger" onClick={() => setDeleting(r)}>
          Delete
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CreateEventForm onCreated={() => void refetch()} />
        <CsvImport onImported={() => void refetch()} />
        <WindowSetting current={windowMinutes} onSaved={() => void refetch()} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <FilterTabs value={scope} onChange={setScope} options={SCOPES} />
        <span className="text-xs text-muted">{data.total} events</span>
      </div>
      <div className="card !p-0 overflow-hidden">
        <DataTable
          columns={columns}
          rows={data.items}
          loading={loading}
          error={error}
          rowKey={(r) => r.id}
          emptyTitle={scope === "upcoming" ? "No upcoming events" : "No past events"}
          emptyDescription="Add events by hand, import a CSV, or set NEWS_CALENDAR_URL."
        />
        <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
      </div>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this event?"
        description={deleting ? `${deleting.currency} ${deleting.title} at ${formatDateTime(deleting.scheduledAt)} EAT. Its news window stops applying immediately. This is audit-logged.` : ""}
        confirmLabel="Delete"
        danger
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function CreateEventForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [impact, setImpact] = useState("HIGH");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const at = new Date(when);
    if (!when || Number.isNaN(at.getTime())) {
      toast.push("Pick a date and time", "error");
      return;
    }
    setBusy(true);
    try {
      // datetime-local is the admin's local wall time; send the absolute instant.
      await post({ action: "create", title, currency: currency.toUpperCase(), impact, scheduledAt: at.toISOString() });
      toast.push("Event added", "success");
      setTitle("");
      onCreated();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Could not add the event", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card flex flex-col gap-2 p-4" onSubmit={submit}>
      <h2 className="text-sm font-semibold">Add event</h2>
      <input className="input-base" placeholder="Title, e.g. Non-Farm Payrolls" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} aria-label="Title" />
      <div className="grid grid-cols-2 gap-2">
        <input className="input-base font-mono uppercase" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} minLength={3} required aria-label="Currency" />
        <select className="input-base" value={impact} onChange={(e) => setImpact(e.target.value)} aria-label="Impact">
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
      </div>
      <input type="datetime-local" className="input-base" value={when} onChange={(e) => setWhen(e.target.value)} required aria-label="Date and time" />
      <p className="text-[11px] text-muted">Time is in your browser&apos;s time zone. Only HIGH events restrict trading.</p>
      <button className="btn-primary !py-1.5 text-xs" disabled={busy}>
        {busy ? "Adding…" : "Add event"}
      </button>
    </form>
  );
}

function CsvImport({ onImported }: { onImported: () => void }) {
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const toast = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setReport(null);
    try {
      const r = (await post({ action: "import", csv })) as { created: number; updated: number; errors: { line: number; message: string }[] };
      toast.push(`Imported: ${r.created} new, ${r.updated} updated`, "success");
      setReport(r.errors.length ? r.errors.slice(0, 5).map((e) => `line ${e.line}: ${e.message}`).join("\n") + (r.errors.length > 5 ? `\n… ${r.errors.length - 5} more` : "") : null);
      if (r.errors.length === 0) setCsv("");
      onImported();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Import failed", "error");
    } finally {
      setBusy(false);
    }
  }

  async function loadFile(file: File | undefined) {
    if (file) setCsv(await file.text());
  }

  return (
    <form className="card flex flex-col gap-2 p-4" onSubmit={submit}>
      <h2 className="text-sm font-semibold">Bulk import (CSV)</h2>
      <textarea className="input-base h-24 font-mono text-[11px]" placeholder={CSV_EXAMPLE} value={csv} onChange={(e) => setCsv(e.target.value)} aria-label="CSV" />
      <input type="file" accept=".csv,text/csv" className="text-xs text-muted" onChange={(e) => void loadFile(e.target.files?.[0])} aria-label="CSV file" />
      <p className="text-[11px] text-muted">Columns: title,currency,impact,datetime (ISO-8601 with offset). Re-importing the same rows updates them.</p>
      {report && <pre className="whitespace-pre-wrap rounded bg-danger/10 p-2 text-[11px] text-danger">{report}</pre>}
      <button className="btn-secondary !py-1.5 text-xs" disabled={busy || !csv.trim()}>
        {busy ? "Importing…" : "Import"}
      </button>
    </form>
  );
}

function WindowSetting({ current, onSaved }: { current: number | undefined; onSaved: () => void }) {
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const shown = value ?? (current != null ? String(current) : "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post({ action: "setWindow", minutes: Number(shown) });
      toast.push("News window saved", "success");
      setValue(null);
      onSaved();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "Could not save", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card flex flex-col gap-2 p-4" onSubmit={submit}>
      <h2 className="text-sm font-semibold">News window</h2>
      <label className="text-xs text-muted" htmlFor="news-window">
        Minutes before and after each HIGH event (SystemSetting rules.newsWindowMinutes)
      </label>
      <input id="news-window" type="number" min={0} max={120} step={1} className="input-base" value={shown} onChange={(e) => setValue(e.target.value)} required />
      <p className="text-[11px] text-muted">0 disables the restriction for everyone. Default 2.</p>
      <button className="btn-secondary !py-1.5 text-xs" disabled={busy || shown === ""}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
