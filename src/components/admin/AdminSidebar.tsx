"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import { useState } from "react";

const NAV_GROUPS: { label: string | null; items: { href: string; label: string }[] }[] = [
  {
    label: null,
    items: [
      { href: "/admin", label: "Overview" },
      { href: "/admin/ai", label: "MellaFx AI" },
    ],
  },
  {
    label: "Traders",
    items: [
      { href: "/admin/accounts", label: "Accounts" },
      { href: "/admin/users", label: "Users" },
      { href: "/admin/kyc", label: "KYC" },
      { href: "/admin/crm", label: "CRM" },
      { href: "/admin/integrity", label: "Integrity" },
    ],
  },
  {
    label: "Products",
    items: [
      { href: "/admin/templates", label: "Templates" },
      { href: "/admin/trading-engine", label: "Trading Engine" },
      { href: "/admin/storefront", label: "Storefront" },
      { href: "/admin/marketplace", label: "Marketplace" },
    ],
  },
  {
    label: "Finance",
    items: [{ href: "/admin/finance", label: "Finance & Payments" }],
  },
];

export function AdminSidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-2 to-accent text-sm font-bold text-white">
          M
        </div>
        <span className="text-base font-semibold">MellaFx</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map((group, idx) => (
          <div key={idx} className="mb-4">
            {group.label && (
              <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted">{group.label}</div>
            )}
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={clsx(
                      "rounded-lg px-3 py-2 text-sm font-medium transition",
                      active ? "bg-accent-2/15 text-accent-2" : "text-muted hover:bg-white/5 hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3 text-sm">
        <div className="truncate px-2 py-1 text-xs text-muted">{email}</div>
        <Link href="/admin/settings" className="block rounded-lg px-2 py-1.5 text-muted hover:bg-white/5 hover:text-foreground">
          Settings
        </Link>
        <button onClick={handleLogout} disabled={loggingOut} className="block w-full rounded-lg px-2 py-1.5 text-left text-danger hover:bg-danger/10">
          {loggingOut ? "Logging out..." : "Logout"}
        </button>
      </div>
    </aside>
  );
}
