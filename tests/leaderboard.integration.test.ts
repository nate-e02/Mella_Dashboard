import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getLeaderboard, invalidateLeaderboardCache, updateLeaderboardProfile } from "@/lib/services/leaderboard";
import { TestFixtures } from "./helpers/fixtures";

const fixtures = new TestFixtures();
beforeEach(() => invalidateLeaderboardCache());
afterEach(() => fixtures.cleanup());

function alias(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** An opted-in (or not) trader with one account that has `trades` closed trades totalling `netProfit`. */
async function traderWithTrades(opts: { alias: string; optIn?: boolean; netProfit: number; trades?: number; startingBalance?: number; status?: "ACTIVE" | "FAILED" | "FUNDED"; closedAt?: Date }) {
  const user = await fixtures.createUser();
  await prisma.user.update({ where: { id: user.id }, data: { leaderboardOptIn: opts.optIn ?? true, publicAlias: opts.alias } });
  const template = await fixtures.createTemplate({ startingBalance: opts.startingBalance ?? 100_000, accountSize: opts.startingBalance ?? 100_000 });
  const account = await fixtures.createAccount({ userId: user.id, template, status: opts.status ?? "ACTIVE" });
  const n = opts.trades ?? 5;
  for (let i = 0; i < n; i++) {
    // Four +100 trades; the last carries the remainder so the total is exact.
    const pnl = i < n - 1 ? 100 : opts.netProfit - 100 * (n - 1);
    await fixtures.addClosedTrade(account.id, pnl, opts.closedAt ?? new Date(Date.now() - 2 * 3_600_000));
  }
  return { user, account };
}

function onlyOurs<T extends { alias: string }>(rows: T[], aliases: string[]) {
  return rows.filter((r) => aliases.includes(r.alias));
}

describe("leaderboard", () => {
  it("ranks opted-in traders by return % and never exposes user ids", async () => {
    const [a, b, c] = [alias("lb_a"), alias("lb_b"), alias("lb_c")];
    await traderWithTrades({ alias: a, netProfit: 5_000 }); // 5%
    const { user: bUser } = await traderWithTrades({ alias: b, netProfit: 2_000, startingBalance: 10_000 }); // 20%
    await traderWithTrades({ alias: c, netProfit: -1_000 }); // -1%

    const board = await getLeaderboard("all", bUser.id);
    const ours = onlyOurs(board.rows, [a, b, c]);
    expect(ours.map((r) => [r.alias, r.returnPct])).toEqual([
      [b, 20],
      [a, 5],
      [c, -1],
    ]);
    expect(ours[0].rank).toBeLessThan(ours[1].rank);
    expect(ours[0]).toMatchObject({ trades: 5, winRate: 100, phase: "PHASE_1", isMe: true });
    expect(ours[2]).toMatchObject({ winRate: 80, isMe: false }); // last trade -1,400
    expect(board.me).toMatchObject({ alias: b, isMe: true });
    expect(JSON.stringify(board)).not.toContain(bUser.id);
  });

  it("excludes traders who have not opted in, failed accounts, archived trades and too few trades", async () => {
    const [shown, hidden, failed, few, archived] = [alias("lb_ok"), alias("lb_no"), alias("lb_fail"), alias("lb_few"), alias("lb_arch")];
    await traderWithTrades({ alias: shown, netProfit: 1_000 });
    await traderWithTrades({ alias: hidden, optIn: false, netProfit: 9_000 });
    await traderWithTrades({ alias: failed, netProfit: 9_000, status: "FAILED" });
    await traderWithTrades({ alias: few, netProfit: 9_000, trades: 4 });
    const { account } = await traderWithTrades({ alias: archived, netProfit: 9_000 });
    await prisma.trade.updateMany({ where: { accountId: account.id }, data: { archivedAt: new Date() } });

    const board = await getLeaderboard("all");
    expect(onlyOurs(board.rows, [shown, hidden, failed, few, archived]).map((r) => r.alias)).toEqual([shown]);
  });

  it("counts only trades closed in the last 30 days for the 30d period", async () => {
    const [recent, old] = [alias("lb_new"), alias("lb_old")];
    await traderWithTrades({ alias: recent, netProfit: 1_000 });
    await traderWithTrades({ alias: old, netProfit: 9_000, closedAt: new Date(Date.now() - 40 * 86_400_000) });

    expect(onlyOurs((await getLeaderboard("30d")).rows, [recent, old]).map((r) => r.alias)).toEqual([recent]);
    expect(onlyOurs((await getLeaderboard("all")).rows, [recent, old]).map((r) => r.alias)).toEqual([old, recent]);
  });

  it("uses each trader's best account", async () => {
    const name = alias("lb_best");
    const { user } = await traderWithTrades({ alias: name, netProfit: 1_000 });
    const template = await fixtures.createTemplate({ phase: "FUNDED", profitTarget: null });
    const funded = await fixtures.createAccount({ userId: user.id, template, status: "FUNDED" });
    for (let i = 0; i < 5; i++) await fixtures.addClosedTrade(funded.id, 300);

    const rows = onlyOurs((await getLeaderboard("all")).rows, [name]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ phase: "FUNDED", returnPct: 15 });
  });
});

describe("leaderboard profile", () => {
  it("requires an alias to opt in, normalises it and keeps aliases unique", async () => {
    const [u1, u2] = [await fixtures.createUser(), await fixtures.createUser()];
    await expect(updateLeaderboardProfile(u1.id, { optIn: true })).rejects.toThrow(/Choose an alias/);
    await expect(updateLeaderboardProfile(u1.id, { optIn: true, alias: "<b>x</b>" })).rejects.toThrow(/Alias must be/);

    const name = alias("Pip");
    const saved = await updateLeaderboardProfile(u1.id, { optIn: true, alias: `  ${name}  ` });
    expect(saved).toEqual({ leaderboardOptIn: true, publicAlias: name });
    await expect(updateLeaderboardProfile(u2.id, { optIn: true, alias: name.toUpperCase() })).rejects.toThrow(/already taken/);

    // Opting out keeps the alias for next time.
    expect(await updateLeaderboardProfile(u1.id, { optIn: false })).toEqual({ leaderboardOptIn: false, publicAlias: name });
  });

  it("reflects an opt-out immediately despite the cache", async () => {
    const name = alias("lb_out");
    const { user } = await traderWithTrades({ alias: name, netProfit: 1_000 });
    expect(onlyOurs((await getLeaderboard("all")).rows, [name])).toHaveLength(1);
    await updateLeaderboardProfile(user.id, { optIn: false });
    expect(onlyOurs((await getLeaderboard("all")).rows, [name])).toHaveLength(0);
  });
});
