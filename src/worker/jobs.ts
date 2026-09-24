import { prisma } from "@/lib/prisma";
import { runRiskSweep } from "@/lib/services/challengeEngine";
import type { Engine, EngineLogger } from "@/trading/engine";

/**
 * Periodic jobs guarded by a Postgres advisory lock so that only one worker
 * replica runs each of them. The lock is transaction-scoped
 * (pg_try_advisory_xact_lock) and held on a dedicated pooled connection for
 * the duration of the job, which runs on the regular client.
 */

export const LOCK_KEYS = {
  riskSweep: 0x4d465801,
  sessionCleanup: 0x4d465802,
  barRetention: 0x4d465803,
} as const;

export async function withAdvisoryLock<T>(key: number, timeoutMs: number, fn: () => Promise<T>): Promise<{ ran: true; result: T } | { ran: false }> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${key}) AS locked`;
      if (!rows[0]?.locked) return { ran: false as const };
      const result = await fn();
      return { ran: true as const, result };
    },
    { timeout: timeoutMs, maxWait: 5_000 },
  );
}

export type JobRunner = { stop: () => void };

export function startJobs(deps: { engine: Engine; log: EngineLogger; barRetentionDays?: number }): JobRunner {
  const { engine, log } = deps;
  const timers: NodeJS.Timeout[] = [];
  const retentionDays = deps.barRetentionDays ?? 400;

  const guard = (name: string, key: number, timeoutMs: number, fn: () => Promise<unknown>) => async () => {
    try {
      const out = await withAdvisoryLock(key, timeoutMs, fn);
      if (out.ran) log.info({ job: name, result: out.result }, "job: done");
      else log.debug({ job: name }, "job: skipped (another replica holds the lock)");
    } catch (err) {
      log.error({ job: name, err: (err as Error).message }, "job: failed");
    }
  };

  const sweep = guard("risk-sweep", LOCK_KEYS.riskSweep, 10 * 60_000, async () => {
    const result = await runRiskSweep();
    engine.setLastSweep({ ...result, at: new Date().toISOString() });
    return result;
  });
  const sessions = guard("session-cleanup", LOCK_KEYS.sessionCleanup, 5 * 60_000, async () => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const res = await prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null, lt: weekAgo } }] } });
    return { deleted: res.count };
  });
  const bars = guard("bar-retention", LOCK_KEYS.barRetention, 30 * 60_000, async () => {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    const res = await prisma.bar.deleteMany({ where: { timeframe: "1m", time: { lt: cutoff } } });
    return { deleted: res.count, cutoff: cutoff.toISOString() };
  });

  timers.push(setTimeout(() => void sweep(), 10_000));
  timers.push(setInterval(() => void sweep(), 60_000));
  timers.push(setTimeout(() => void sessions(), 30_000));
  timers.push(setInterval(() => void sessions(), 60 * 60_000));
  timers.push(setTimeout(() => void bars(), 60_000));
  timers.push(setInterval(() => void bars(), 24 * 60 * 60_000));

  return {
    stop() {
      for (const t of timers) clearTimeout(t);
    },
  };
}
