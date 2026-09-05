"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import { useState } from "react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/trade", label: "Trade" },
  { href: "/challenges", label: "Challenges" },
  { href: "/purchases", label: "My Purchases" },
  { href: "/history", label: "History" },
  { href: "/account", label: "Account" },
];

export function TraderNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-2 to-accent text-sm font-bold text-white">
            M
          </div>
          <span className="text-base font-semibold">MellaFx</span>
        </div>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                "rounded-lg px-3 py-2 text-sm font-medium transition",
                pathname.startsWith(item.href) ? "bg-accent-2/15 text-accent-2" : "text-muted hover:bg-white/5 hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden md:block">
          <button onClick={handleLogout} disabled={loggingOut} className="btn-secondary !py-1.5 text-sm">
            {loggingOut ? "Logging out..." : "Logout"}
          </button>
        </div>

        <button className="btn-secondary !px-3 !py-1.5 md:hidden" onClick={() => setMobileOpen((v) => !v)}>
          ☰
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-border px-4 py-3 md:hidden">
          <div className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={clsx(
                  "rounded-lg px-3 py-2 text-sm font-medium",
                  pathname.startsWith(item.href) ? "bg-accent-2/15 text-accent-2" : "text-muted",
                )}
              >
                {item.label}
              </Link>
            ))}
            <button onClick={handleLogout} className="mt-1 rounded-lg px-3 py-2 text-left text-sm text-danger">
              Logout
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
