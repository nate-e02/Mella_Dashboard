import "server-only";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/services/audit";
import { ConflictError } from "@/lib/errors";
import { workerRequest } from "@/lib/services/settings";

/** Feed providers the worker can start (see src/trading/feeds/index.ts). STUB2.. are simulated standbys for development. */
export const FEED_SOURCE_PATTERN = /^(STUB\d*|BINANCE|CTRADER|TRADERMADE)$/;

/**
 * Sets (or clears) an instrument's hot-standby feed. The worker picks the
 * change up immediately when reachable (otherwise within its 60 s reload) and
 * restarts only the providers whose subscription set changed.
 */
export async function setInstrumentBackupFeed(symbol: string, input: { backupFeedSource: string | null; backupFeedSymbol: string | null }, actorId: string) {
  const before = await prisma.instrument.findUniqueOrThrow({ where: { symbol } });
  const source = input.backupFeedSource?.trim().toUpperCase() || null;
  const feedSymbol = input.backupFeedSymbol?.trim() || null;
  if (source && !FEED_SOURCE_PATTERN.test(source)) throw new ConflictError(`Unknown feed source ${source} (STUB, STUB2, BINANCE, CTRADER or TRADERMADE)`);
  if (source && source === before.feedSource.toUpperCase()) throw new ConflictError("The backup feed must differ from the primary feed");
  const updated = await prisma.instrument.update({
    where: { symbol },
    data: { backupFeedSource: source, backupFeedSymbol: source ? feedSymbol : null },
  });
  await logAudit({
    actorId,
    action: "INSTRUMENT_BACKUP_FEED_UPDATED",
    targetType: "Instrument",
    targetId: symbol,
    before: { feedSource: before.feedSource, backupFeedSource: before.backupFeedSource, backupFeedSymbol: before.backupFeedSymbol },
    after: { feedSource: updated.feedSource, backupFeedSource: updated.backupFeedSource, backupFeedSymbol: updated.backupFeedSymbol },
  });
  void workerRequest("/internal/reload-instruments", { method: "POST" }).catch(() => undefined);
  return updated;
}
