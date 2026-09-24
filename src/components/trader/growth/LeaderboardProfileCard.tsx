"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/i18n/client";

const ALIAS_PATTERN = /^[A-Za-z0-9_ ]{3,20}$/;

/** The viewer's own leaderboard settings: opt-in and public alias (never their real name). */
export function LeaderboardProfileCard({
  optIn,
  alias,
  me,
}: {
  optIn: boolean;
  alias: string | null;
  me: { rank: number; returnPct: string; total: number } | null;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [enabled, setEnabled] = useState(optIn);
  const [value, setValue] = useState(alias ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = value.trim().replace(/\s+/g, " ");
  const aliasValid = ALIAS_PATTERN.test(normalized);
  const dirty = enabled !== optIn || normalized !== (alias ?? "");

  async function save() {
    if (enabled && !aliasValid) {
      setError(t("growth.leaderboard.profile.aliasRules"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/trader/leaderboard/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optIn: enabled, alias: normalized ? normalized : null }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && /taken/i.test(body.error ?? "")) throw new Error(t("growth.leaderboard.profile.aliasTaken"));
      if (!res.ok) throw new Error(body.issues ? t("growth.leaderboard.profile.aliasRules") : t("common.unexpectedError"));
      toast.push(enabled ? t("growth.leaderboard.profile.savedIn") : t("growth.leaderboard.profile.savedOut"), "success");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.unexpectedError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card flex flex-col gap-4 p-5 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex flex-1 flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t("growth.leaderboard.profile.title")}</h2>
          <p className="text-xs text-muted">{t("growth.leaderboard.profile.body")}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-accent-2" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>{t("growth.leaderboard.profile.optIn")}</span>
        </label>
        <div className="flex flex-col gap-1 sm:max-w-sm">
          <label htmlFor="leaderboard-alias" className="text-xs font-medium text-muted">
            {t("growth.leaderboard.profile.aliasLabel")}
          </label>
          <input
            id="leaderboard-alias"
            className="input-base"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={20}
            placeholder={t("growth.leaderboard.profile.aliasPlaceholder")}
            aria-invalid={!!error}
            aria-describedby="leaderboard-alias-help"
          />
          <p id="leaderboard-alias-help" className={error ? "text-xs text-danger" : "text-xs text-muted"} role={error ? "alert" : undefined}>
            {error ?? t("growth.leaderboard.profile.aliasRules")}
          </p>
        </div>
        <div>
          <button className="btn-primary" onClick={save} disabled={saving || !dirty}>
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-surface-2 px-5 py-4 text-center lg:min-w-[220px]">
        <div className="text-xs uppercase tracking-wide text-muted">{t("growth.leaderboard.profile.yourRank")}</div>
        {me ? (
          <>
            <div className="mt-1 text-3xl font-semibold">#{me.rank}</div>
            <div className="text-xs text-muted">{t("growth.leaderboard.profile.rankOf", { total: me.total, value: me.returnPct })}</div>
          </>
        ) : (
          <div className="mt-2 text-xs text-muted">{optIn ? t("growth.leaderboard.profile.notRanked") : t("growth.leaderboard.profile.notOptedIn")}</div>
        )}
      </div>
    </div>
  );
}
