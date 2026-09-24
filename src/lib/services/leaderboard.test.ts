import { describe, expect, it } from "vitest";
import { normalizeAlias, rankLeaderboard, type LeaderboardSourceRow } from "@/lib/services/leaderboard";

function row(overrides: Partial<LeaderboardSourceRow>): LeaderboardSourceRow {
  return { userId: "u1", alias: "Alpha", accountId: "a1", phase: "PHASE_1", startingBalance: 100_000, netProfit: 0, trades: 10, wins: 5, ...overrides };
}

describe("rankLeaderboard", () => {
  it("ranks by return % of the starting balance", () => {
    const ranked = rankLeaderboard([
      row({ userId: "u1", alias: "Small", startingBalance: 10_000, netProfit: 1_000 }), // 10%
      row({ userId: "u2", alias: "Big", startingBalance: 1_000_000, netProfit: 50_000 }), // 5%
      row({ userId: "u3", alias: "Loss", startingBalance: 100_000, netProfit: -2_000 }), // -2%
    ]);
    expect(ranked.map((r) => [r.alias, r.rank, r.returnPct])).toEqual([
      ["Small", 1, 10],
      ["Big", 2, 5],
      ["Loss", 3, -2],
    ]);
  });

  it("keeps only each user's best account", () => {
    const ranked = rankLeaderboard([
      row({ userId: "u1", accountId: "a1", netProfit: 1_000 }),
      row({ userId: "u1", accountId: "a2", netProfit: 8_000, phase: "FUNDED" }),
      row({ userId: "u2", alias: "Beta", accountId: "b1", netProfit: 3_000 }),
    ]);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]).toMatchObject({ userId: "u1", returnPct: 8, phase: "FUNDED", rank: 1 });
  });

  it("requires the minimum number of closed trades", () => {
    const ranked = rankLeaderboard([row({ userId: "u1", trades: 4, netProfit: 50_000 }), row({ userId: "u2", alias: "Ok", trades: 5, netProfit: 10 })]);
    expect(ranked.map((r) => r.userId)).toEqual(["u2"]);
  });

  it("gives equal returns the same rank (1, 2, 2, 4) and computes win rate", () => {
    const ranked = rankLeaderboard([
      row({ userId: "a", alias: "A", netProfit: 9_000 }),
      row({ userId: "b", alias: "B", netProfit: 5_000, trades: 20 }),
      row({ userId: "c", alias: "C", netProfit: 5_000, trades: 10, wins: 7 }),
      row({ userId: "d", alias: "D", netProfit: 1_000 }),
    ]);
    expect(ranked.map((r) => [r.alias, r.rank])).toEqual([
      ["A", 1],
      ["B", 2],
      ["C", 2],
      ["D", 4],
    ]);
    expect(ranked[2].winRate).toBe(70);
  });
});

describe("normalizeAlias", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeAlias("  Addis   Bull ")).toBe("Addis Bull");
    expect(normalizeAlias("pip_hunter_7")).toBe("pip_hunter_7");
  });

  it("enforces 3–20 letters, digits, spaces or underscores", () => {
    expect(normalizeAlias("ab")).toBeNull();
    expect(normalizeAlias("x".repeat(21))).toBeNull();
    expect(normalizeAlias("bad<alias>")).toBeNull();
    expect(normalizeAlias("emoji🚀")).toBeNull();
  });
});
