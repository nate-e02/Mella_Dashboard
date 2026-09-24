"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { timeAgo } from "@/lib/format";

type Notification = { id: string; title: string; message: string; type: string; link: string | null; read: boolean; createdAt: string };

const POLL_MS = 60_000;

export function NotificationsBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/trader/notifications");
      if (!res.ok) return;
      const body = await res.json();
      setItems(body.items);
      setUnread(body.unread);
    } catch {
      // offline: keep last known state
    }
  }, []);

  useEffect(() => {
    // Initial load + polling of an external data source.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const timer = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function openPanel() {
    setOpen((v) => !v);
    if (!open && unread > 0) {
      await fetch("/api/trader/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={openPanel} className="btn-secondary relative !px-2.5 !py-1.5 text-sm" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open}>
        <span aria-hidden>🔔</span>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{unread > 9 ? "9+" : unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Notifications</div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted">No notifications yet.</li>}
            {items.map((n) => (
              <li key={n.id} className={`border-b border-border/60 px-3 py-2 text-xs last:border-0 ${n.read ? "" : "bg-accent-2/5"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`font-medium ${n.type === "danger" ? "text-danger" : n.type === "success" ? "text-success" : "text-foreground"}`}>{n.title}</span>
                  <span className="text-[10px] text-muted">{timeAgo(n.createdAt)}</span>
                </div>
                <p className="mt-0.5 text-muted">{n.message}</p>
                {n.link && (
                  <Link href={n.link} className="mt-1 inline-block text-accent-2 hover:underline" onClick={() => setOpen(false)}>
                    Open →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
