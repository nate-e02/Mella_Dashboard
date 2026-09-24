"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { clsx } from "clsx";
import { LOCALES, type Locale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/client";

const SHORT: Record<Locale, string> = { en: "EN", am: "አማ" };

/** Compact EN / አማ toggle. Persists via /api/locale (cookie + user profile) and re-renders server components. */
export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function choose(next: Locale) {
    if (next === locale) return;
    await fetch("/api/locale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: next }) });
    startTransition(() => router.refresh());
  }

  return (
    <div role="group" aria-label={t("common.language")} className={clsx("inline-flex rounded-lg border border-border p-0.5 text-xs", pending && "opacity-60", className)}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          onClick={() => void choose(l)}
          aria-pressed={l === locale}
          title={t(`common.language.${l}`)}
          className={clsx("rounded-md px-2 py-1 font-medium transition", l === locale ? "bg-accent-2/20 text-accent-2" : "text-muted hover:text-foreground")}
        >
          {SHORT[l]}
        </button>
      ))}
    </div>
  );
}
