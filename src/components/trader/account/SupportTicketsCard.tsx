"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { StatusBadge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/format";
import { useT } from "@/i18n/client";

type Ticket = { id: string; subject: string; message: string; response: string | null; status: string; createdAt: string };

export function SupportTicketsCard() {
  const t = useT();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function load() {
    const res = await fetch("/api/trader/support");
    if (res.ok) setTickets(await res.json());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/trader/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || body.issues?.[0]?.message || t("auth.support.failed"));
      toast.push(t("auth.support.submitted"), "success");
      setSubject("");
      setMessage("");
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : t("auth.support.failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col gap-4 p-5">
      <div>
        <h3 className="text-sm font-semibold">{t("auth.support.title")}</h3>
        <p className="text-xs text-muted">{t("auth.support.subtitle")}</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-2 text-sm">
        <input className="input-base" placeholder={t("auth.support.subject")} value={subject} onChange={(e) => setSubject(e.target.value)} required minLength={3} maxLength={150} />
        <textarea className="input-base" rows={3} placeholder={t("auth.support.message")} value={message} onChange={(e) => setMessage(e.target.value)} required minLength={5} maxLength={4000} />
        <button type="submit" className="btn-secondary self-start !py-1.5 text-xs" disabled={busy}>
          {busy ? t("auth.support.sending") : t("auth.support.submit")}
        </button>
      </form>
      {tickets.length > 0 && (
        <ul className="flex flex-col gap-2">
          {tickets.map((ticket) => (
            <li key={ticket.id} className="rounded-lg border border-border bg-surface-2 p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">{ticket.subject}</span>
                <StatusBadge status={ticket.status} />
              </div>
              <p className="mt-1 text-muted">{ticket.message}</p>
              {ticket.response && <p className="mt-2 border-l-2 border-accent-2 pl-2 text-foreground">{ticket.response}</p>}
              <p className="mt-1 text-[10px] text-muted">{formatDateTime(ticket.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
