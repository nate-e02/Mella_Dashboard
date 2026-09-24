import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError } from "@/lib/errors";
import { logAudit } from "@/lib/services/audit";

export const LEADERBOARD_PERIODS = ["30d", "all"] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];
export const LEADERBOARD_LIMIT = 50;
export const LEADERBOARD_MIN_TRADES = 5;
const CACHE_TTL_MS = 60_000;

/** One opted-in trader's best qualifying account, as aggregated in SQL. */
export type LeaderboardSourceRow = {
  userId: string;
  alias: string;
  accountId: string;
  phase: string;
  startingBalance: number;
  netProfit: number;
  trades: number;
  wins: number;
};

export type LeaderboardEntry = {
  rank: number;
  userId: string;
  alias: string;
  phase: string;
  returnPct: number;
  trades: number;
  winRate: number;
};

/**
 * Pure ranking: keeps each user's best account (highest return, then most
 * trades), drops anything under the minimum trade count, sorts by return
 * and assigns competition ranks (equal returns share a rank: 1, 2, 2, 4).
 */
export function rankLeaderboard(rows: LeaderboardSourceRow[], minTrades = LEADERBOARD_MIN_TRADES): LeaderboardEntry[] {
  const best = new Map<string, LeaderboardEntry>();
  for (const r of rows) {
    if (r.trades < minTrades || !(r.startingBalance > 0)) continue;
    const entry: LeaderboardEntry = {
      rank: 0,
      userId: r.userId,
      alias: r.alias,
      phase: r.phase,
      returnPct: Math.round((r.netProfit / r.startingBalance) * 10_000) / 100,
      trades: r.trades,
      winRate: Math.round((r.wins / r.trades) * 1000) / 10,
    };
    const current = best.get(r.userId);
    if (!current || entry.returnPct > current.returnPct || (entry.returnPct === current.returnPct && entry.trades > current.trades)) {
      best.set(r.userId, entry);
    }
  }
  const sorted = [...best.values()].sort(
    (a, b) => b.returnPct - a.returnPct || b.trades - a.trades || a.alias.localeCompare(b.alias) || a.userId.localeCompare(b.userId),
  );
  sorted.forEach((e, i) => {
    e.rank = i > 0 && e.returnPct === sorted[i - 1].returnPct ? sorted[i - 1].rank : i + 1;
  });
  return sorted;
}

/**
 * Per-account aggregates of closed, non-archived trades (optionally only
 * those closed in the last 30 days) for opted-in active traders with an
 * alias, on ACTIVE / PASSED / FUNDED accounts. Returns every opted-in
 * trader's best account so the caller's own rank can be found even outside
 * the top 50; the set is small (opt-in only) and cached.
 */
async function loadSourceRows(period: LeaderboardPeriod, now: Date): Promise<LeaderboardSourceRow[]> {
  const since = period === "30d" ? new Date(now.getTime() - 30 * 86_400_000) : null;
  const periodFilter = since ? Prisma.sql`AND t."closeTime" >= ${since}` : Prisma.empty;
  const rows = await prisma.$queryRaw<
    { userId: string; alias: string; accountId: string; phase: string; startingBalance: number; netProfit: number; trades: number; wins: number }[]
  >(Prisma.sql`
    WITH per_account AS (
      SELECT a.id AS "accountId", a."userId", a.phase::text AS phase, a."startingBalance",
             COALESCE(SUM(t."netProfit"), 0)::float8 AS "netProfit",
             COUNT(t.id)::int AS trades,
             (COUNT(*) FILTER (WHERE t."netProfit" > 0))::int AS wins
      FROM "TradingAccount" a
      JOIN "User" u ON u.id = a."userId"
      JOIN "Trade" t ON t."accountId" = a.id AND t.status = 'CLOSED' AND t."archivedAt" IS NULL ${periodFilter}
      WHERE u."leaderboardOptIn" = true
        AND u."publicAlias" IS NOT NULL
        AND u.status = 'ACTIVE'
        AND u.role = 'TRADER'
        AND a.status IN ('ACTIVE', 'PASSED', 'FUNDED')
        AND a."startingBalance" > 0
      GROUP BY a.id
      HAVING COUNT(t.id) >= ${LEADERBOARD_MIN_TRADES}
    )
    SELECT DISTINCT ON (p."userId") p.*, u."publicAlias" AS alias
    FROM per_account p
    JOIN "User" u ON u.id = p."userId"
    ORDER BY p."userId", p."netProfit" / p."startingBalance" DESC, p.trades DESC
  `);
  return rows.map((r) => ({ ...r, startingBalance: Number(r.startingBalance), netProfit: Number(r.netProfit), trades: Number(r.trades), wins: Number(r.wins) }));
}

const cache = new Map<LeaderboardPeriod, { at: number; entries: LeaderboardEntry[] }>();

/** Full ranking for a period, cached in memory for 60 s per process. */
async function rankedEntries(period: LeaderboardPeriod, now = new Date()): Promise<LeaderboardEntry[]> {
  const hit = cache.get(period);
  if (hit && now.getTime() - hit.at < CACHE_TTL_MS) return hit.entries;
  const entries = rankLeaderboard(await loadSourceRows(period, now));
  cache.set(period, { at: now.getTime(), entries });
  return entries;
}

export function invalidateLeaderboardCache() {
  cache.clear();
}

/** Top 50 (no user ids) plus the viewer's own entry when they are ranked. */
export async function getLeaderboard(period: LeaderboardPeriod, viewerId?: string) {
  const entries = await rankedEntries(period);
  const strip = ({ userId, ...rest }: LeaderboardEntry) => ({ ...rest, isMe: !!viewerId && userId === viewerId });
  const mine = viewerId ? entries.find((e) => e.userId === viewerId) : undefined;
  return { rows: entries.slice(0, LEADERBOARD_LIMIT).map(strip), me: mine ? strip(mine) : null, total: entries.length };
}

export type PublicLeaderboardRow = Awaited<ReturnType<typeof getLeaderboard>>["rows"][number];

/** Aliases: 3–20 letters, digits, spaces or underscores; inner whitespace collapsed. */
export const ALIAS_PATTERN = /^[A-Za-z0-9_ ]{3,20}$/;

export function normalizeAlias(raw: string): string | null {
  const alias = raw.trim().replace(/\s+/g, " ");
  return ALIAS_PATTERN.test(alias) ? alias : null;
}

export async function getLeaderboardProfile(userId: string) {
  return prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { leaderboardOptIn: true, publicAlias: true } });
}

/**
 * Opt in/out and set the public alias. Opting in requires an alias; aliases
 * are unique case-insensitively so nobody can pose as another ranked trader.
 */
export async function updateLeaderboardProfile(userId: string, input: { optIn: boolean; alias?: string | null }) {
  const current = await getLeaderboardProfile(userId);
  let alias = current.publicAlias;
  if (input.alias !== undefined && input.alias !== null) {
    const normalized = normalizeAlias(input.alias);
    if (!normalized) throw new ConflictError("Alias must be 3–20 letters, digits, spaces or underscores");
    alias = normalized;
  }
  if (input.optIn && !alias) throw new ConflictError("Choose an alias to join the leaderboard");

  if (alias && alias !== current.publicAlias) {
    const taken = await prisma.user.findFirst({ where: { id: { not: userId }, publicAlias: { equals: alias, mode: "insensitive" } }, select: { id: true } });
    if (taken) throw new ConflictError("This alias is already taken");
  }

  const updated = await prisma.user.update({ where: { id: userId }, data: { leaderboardOptIn: input.optIn, publicAlias: alias }, select: { leaderboardOptIn: true, publicAlias: true } });
  await logAudit({ actorId: userId, action: "LEADERBOARD_PROFILE_UPDATED", targetType: "User", targetId: userId, before: current, after: updated });
  invalidateLeaderboardCache();
  return updated;
}
