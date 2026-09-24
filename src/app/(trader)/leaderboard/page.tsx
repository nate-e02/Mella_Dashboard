import type { Metadata } from "next";
import Link from "next/link";
import { clsx } from "clsx";
import { requireTraderPage } from "@/lib/auth/pageGuards";
import { getLeaderboard, getLeaderboardProfile, LEADERBOARD_MIN_TRADES, LEADERBOARD_PERIODS, type LeaderboardPeriod } from "@/lib/services/leaderboard";
import { Badge } from "@/components/ui/Badge";
import { LeaderboardProfileCard } from "@/components/trader/growth/LeaderboardProfileCard";
import { getT } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("growth.leaderboard.metaTitle") };
}

const PHASE_TONE = { PHASE_1: "info", PHASE_2: "warning", FUNDED: "success" } as const;

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const [user, { period: rawPeriod }, t] = await Promise.all([requireTraderPage(), searchParams, getT()]);
  const period: LeaderboardPeriod = (LEADERBOARD_PERIODS as readonly string[]).includes(rawPeriod ?? "") ? (rawPeriod as LeaderboardPeriod) : "30d";
  const [board, profile] = await Promise.all([getLeaderboard(period, user.id), getLeaderboardProfile(user.id)]);

  const phaseLabel = (phase: string) => t(`growth.phase.${phase}` as MessageKey);
  const formatReturn = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("growth.leaderboard.title")}</h1>
        <p className="text-sm text-muted">{t("growth.leaderboard.subtitle", { min: LEADERBOARD_MIN_TRADES })}</p>
      </div>

      <LeaderboardProfileCard
        optIn={profile.leaderboardOptIn}
        alias={profile.publicAlias}
        me={board.me ? { rank: board.me.rank, returnPct: formatReturn(board.me.returnPct), total: board.total } : null}
      />

      <div className="card !p-0 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold">{t("growth.leaderboard.tableTitle")}</h2>
          <nav aria-label={t("growth.leaderboard.periodLabel")} className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1">
            {LEADERBOARD_PERIODS.map((p) => (
              <Link
                key={p}
                href={`/leaderboard?period=${p}`}
                aria-current={p === period ? "page" : undefined}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition",
                  p === period ? "bg-accent-2/20 text-accent-2" : "text-muted hover:text-foreground",
                )}
              >
                {t(`growth.leaderboard.period.${p}` as MessageKey)}
              </Link>
            ))}
          </nav>
        </div>
        {board.rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="text-sm font-medium">{t("growth.leaderboard.empty.title")}</div>
            <div className="mt-1 text-xs text-muted">{t("growth.leaderboard.empty.body", { min: LEADERBOARD_MIN_TRADES })}</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 w-16">{t("growth.leaderboard.col.rank")}</th>
                  <th className="px-4 py-2.5">{t("growth.leaderboard.col.trader")}</th>
                  <th className="px-4 py-2.5 text-right">{t("growth.leaderboard.col.return")}</th>
                  <th className="px-4 py-2.5 text-right">{t("growth.leaderboard.col.trades")}</th>
                  <th className="px-4 py-2.5 text-right">{t("growth.leaderboard.col.winRate")}</th>
                  <th className="px-4 py-2.5">{t("growth.leaderboard.col.phase")}</th>
                </tr>
              </thead>
              <tbody>
                {board.rows.map((row) => (
                  <tr key={`${row.rank}-${row.alias}`} className={clsx("border-b border-border/60 last:border-0", row.isMe && "bg-accent-2/10")}>
                    <td className="px-4 py-2.5 font-semibold tabular-nums">{row.rank <= 3 ? ["🥇", "🥈", "🥉"][row.rank - 1] : `#${row.rank}`}</td>
                    <td className="px-4 py-2.5 font-medium">
                      {row.alias}
                      {row.isMe && <span className="ml-2 text-xs text-accent-2">{t("growth.leaderboard.you")}</span>}
                    </td>
                    <td className={clsx("px-4 py-2.5 text-right font-semibold tabular-nums", row.returnPct >= 0 ? "text-success" : "text-danger")}>{formatReturn(row.returnPct)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.trades}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.winRate.toFixed(1)}%</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={PHASE_TONE[row.phase as keyof typeof PHASE_TONE] ?? "default"}>{phaseLabel(row.phase)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-muted">{t("growth.leaderboard.footnote")}</p>
    </div>
  );
}
