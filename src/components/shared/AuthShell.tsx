"use client";

import { clsx } from "clsx";
import { LanguageSwitcher } from "@/components/shared/LanguageSwitcher";

/** Centered card used by the login, register, password and verification pages. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="card relative w-full max-w-sm p-6">
        <LanguageSwitcher className="absolute right-4 top-4" />
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-accent-2 to-accent text-base font-bold text-white">
            M
          </div>
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function AuthTabs<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div role="tablist" aria-label={label} className="mb-4 grid grid-cols-2 rounded-lg border border-border p-0.5 text-sm">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={clsx("rounded-md px-3 py-1.5 font-medium transition", o.value === value ? "bg-accent-2/20 text-accent-2" : "text-muted hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function FormAlert({ tone = "danger", children }: { tone?: "danger" | "success" | "info"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={clsx(
        "rounded-lg px-3 py-2 text-sm",
        tone === "danger" && "bg-danger/10 text-danger",
        tone === "success" && "bg-success/10 text-success",
        tone === "info" && "bg-accent-2/10 text-accent-2",
      )}
    >
      {children}
    </div>
  );
}
