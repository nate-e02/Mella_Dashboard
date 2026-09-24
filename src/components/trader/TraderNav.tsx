"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import { useEffect, useId, useRef, useState } from "react";
import { NotificationsBell } from "@/components/trader/NotificationsBell";
import { LanguageSwitcher } from "@/components/shared/LanguageSwitcher";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/messages";

type NavItem = { href: string; label: MessageKey };

/** Always visible on desktop. */
const PRIMARY_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "common.nav.dashboard" },
  { href: "/trade", label: "common.nav.trade" },
  { href: "/challenges", label: "common.nav.challenges" },
  { href: "/purchases", label: "common.nav.purchases" },
  { href: "/history", label: "common.nav.history" },
  { href: "/account", label: "common.nav.account" },
];

/** Behind the "More" menu on desktop; listed inline on mobile. */
const MORE_ITEMS: NavItem[] = [
  { href: "/leaderboard", label: "common.nav.leaderboard" },
  { href: "/referrals", label: "common.nav.referrals" },
  { href: "/certificates", label: "common.nav.certificates" },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TraderNav() {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const mobileMenuId = useId();

  async function handleLogout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const linkClass = (active: boolean) =>
    clsx(
      "whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium transition xl:px-3",
      active ? "bg-accent-2/15 text-accent-2" : "text-muted hover:bg-white/5 hover:text-foreground",
    );

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-2 to-accent text-sm font-bold text-white" aria-hidden>
            M
          </span>
          <span className="text-base font-semibold">{t("common.appName")}</span>
        </Link>

        <nav aria-label={t("common.nav.primary")} className="hidden min-w-0 items-center gap-0.5 lg:flex">
          {PRIMARY_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} className={linkClass(active)} aria-current={active ? "page" : undefined}>
                {t(item.label)}
              </Link>
            );
          })}
          <MoreMenu items={MORE_ITEMS} pathname={pathname} buttonClass={linkClass} />
        </nav>

        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          <NotificationsBell />
          <LanguageSwitcher />
          <button onClick={handleLogout} disabled={loggingOut} className="btn-secondary !py-1.5 text-sm">
            {loggingOut ? t("common.loggingOut") : t("common.logout")}
          </button>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <NotificationsBell />
          <button
            className="btn-secondary !px-3 !py-1.5"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? t("common.closeMenu") : t("common.openMenu")}
            aria-expanded={mobileOpen}
            aria-controls={mobileMenuId}
          >
            <span aria-hidden>{mobileOpen ? "✕" : "☰"}</span>
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div id={mobileMenuId} className="border-t border-border px-4 py-3 lg:hidden">
          <nav aria-label={t("common.nav.primary")} className="flex flex-col gap-1">
            {[...PRIMARY_ITEMS, ...MORE_ITEMS].map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={clsx("rounded-lg px-3 py-2 text-sm font-medium", active ? "bg-accent-2/15 text-accent-2" : "text-muted")}
                >
                  {t(item.label)}
                </Link>
              );
            })}
          </nav>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-3">
            <div className="flex items-center gap-2 px-3 text-sm text-muted">
              <span>{t("common.language")}</span>
              <LanguageSwitcher />
            </div>
            <button onClick={handleLogout} disabled={loggingOut} className="rounded-lg px-3 py-2 text-left text-sm text-danger">
              {loggingOut ? t("common.loggingOut") : t("common.logout")}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

/**
 * Accessible dropdown for the secondary nav links: opens on click or
 * Enter/Space/ArrowDown, arrow keys move between items, Escape closes and
 * returns focus to the button, and it closes on outside click or Tab away.
 */
function MoreMenu({ items, pathname, buttonClass }: { items: NavItem[]; pathname: string; buttonClass: (active: boolean) => string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const menuId = useId();
  const anyActive = items.some((i) => isActive(pathname, i.href));

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  function focusItem(index: number) {
    const count = items.length;
    itemRefs.current[((index % count) + count) % count]?.focus();
  }

  function openAndFocus(index: number) {
    setOpen(true);
    // Items render on the next frame.
    requestAnimationFrame(() => focusItem(index));
  }

  function onButtonKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openAndFocus(0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openAndFocus(items.length - 1);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusItem(current + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusItem(current - 1);
        break;
      case "Home":
        e.preventDefault();
        focusItem(0);
        break;
      case "End":
        e.preventDefault();
        focusItem(items.length - 1);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        className={clsx(buttonClass(anyActive), "inline-flex items-center gap-1")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKeyDown}
      >
        {t("common.nav.more")}
        <span aria-hidden className={clsx("text-[10px] transition", open && "rotate-180")}>
          ▾
        </span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={t("common.nav.more")}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 z-40 mt-2 min-w-48 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-xl"
        >
          {items.map((item, i) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                tabIndex={-1}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={clsx(
                  "block whitespace-nowrap px-4 py-2 text-sm outline-none transition focus-visible:bg-white/5",
                  active ? "text-accent-2" : "text-muted hover:bg-white/5 hover:text-foreground focus-visible:text-foreground",
                )}
              >
                {t(item.label)}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
