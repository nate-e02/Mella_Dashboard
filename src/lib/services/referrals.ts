import "server-only";
import { randomBytes } from "crypto";
import { Prisma, type ReferralRewardStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AuthError, ConflictError } from "@/lib/errors";
import { logAudit } from "@/lib/services/audit";
import { alertOps, notifyUser } from "@/lib/services/notifications";
import { roundCurrency } from "@/lib/services/calculations";
import { setSetting } from "@/lib/services/settings";
import { maskDisplayName } from "@/lib/displayName";

type Db = Prisma.TransactionClient | typeof prisma;

/** Cookie set by /r/[code] and read at sign-up (email or phone) to credit the referrer. */
export const REFERRAL_COOKIE = "mella_ref";
/** How long a referral link click is remembered before sign-up. */
export const REFERRAL_COOKIE_MAX_AGE_SEC = 30 * 24 * 60 * 60;

/** No 0/O, 1/I/L: codes are read aloud and typed from screenshots. */
export const REFERRAL_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const REFERRAL_CODE_LENGTH = 8;
const REFERRAL_CODE_PATTERN = /^[2-9A-HJKMNP-Z]{8}$/;

export const REFERRAL_COMMISSION_SETTING = "referral.commissionPercent";
export const DEFAULT_REFERRAL_COMMISSION_PERCENT = 10;
export const MAX_REFERRAL_COMMISSION_PERCENT = 50;

/** Random code from REFERRAL_CODE_ALPHABET, rejection-sampled so every character is equally likely. */
export function generateReferralCode(random: (size: number) => Uint8Array = randomBytes): string {
  const n = REFERRAL_CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  let out = "";
  while (out.length < REFERRAL_CODE_LENGTH) {
    for (const byte of random(REFERRAL_CODE_LENGTH * 2)) {
      if (byte >= limit) continue;
      out += REFERRAL_CODE_ALPHABET[byte % n];
      if (out.length === REFERRAL_CODE_LENGTH) break;
    }
  }
  return out;
}

/** Upper-cased code, or null when the input is not shaped like a referral code. */
export function normalizeReferralCode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return REFERRAL_CODE_PATTERN.test(code) ? code : null;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** The user's referral code, assigning one on first use (retrying on the rare unique collision). */
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } });
  if (user.referralCode) return user.referralCode;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      // Conditional so two concurrent first visits cannot overwrite each other's code.
      await prisma.user.updateMany({ where: { id: userId, referralCode: null }, data: { referralCode: generateReferralCode() } });
      const current = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } });
      if (current.referralCode) return current.referralCode;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new Error("Could not allocate a referral code");
}

/**
 * Links a newly created user to the owner of `code` (case-insensitive).
 * No-op for an empty/unknown code, a disabled referrer, a self-referral, or
 * a user who already has a referrer. Never throws: a bad referral code must
 * not break sign-up.
 */
export async function attachReferral(newUserId: string, code: string | null | undefined): Promise<void> {
  try {
    const normalized = normalizeReferralCode(code);
    if (!normalized) return;
    const referrer = await prisma.user.findUnique({ where: { referralCode: normalized }, select: { id: true, status: true } });
    if (!referrer || referrer.id === newUserId || referrer.status !== "ACTIVE") return;

    const claim = await prisma.user.updateMany({ where: { id: newUserId, referredById: null }, data: { referredById: referrer.id } });
    if (claim.count === 1) {
      await logAudit({ actorId: newUserId, action: "REFERRAL_ATTACHED", targetType: "User", targetId: newUserId, after: { referrerId: referrer.id, code: normalized } });
    }
  } catch (err) {
    console.error("attachReferral failed for user", newUserId, err instanceof Error ? err.message : err);
  }
}

/** Commission percent (0–50) paid to the referrer on each paid purchase; 10 when unset or invalid. */
export async function getReferralCommissionPercent(db: Db = prisma): Promise<number> {
  const row = await db.systemSetting.findUnique({ where: { key: REFERRAL_COMMISSION_SETTING } });
  const value = typeof row?.value === "number" ? row.value : Number(row?.value);
  if (row == null || !Number.isFinite(value) || value < 0 || value > MAX_REFERRAL_COMMISSION_PERCENT) return DEFAULT_REFERRAL_COMMISSION_PERCENT;
  return value;
}

export async function setReferralCommissionPercent(percent: number, actorId: string) {
  if (!Number.isFinite(percent) || percent < 0 || percent > MAX_REFERRAL_COMMISSION_PERCENT) {
    throw new ConflictError(`Commission must be between 0 and ${MAX_REFERRAL_COMMISSION_PERCENT}%`);
  }
  // setSetting records a SETTING_UPDATED audit entry with before/after values.
  await setSetting(REFERRAL_COMMISSION_SETTING, roundCurrency(percent), actorId);
  return getReferralCommissionPercent();
}

/**
 * Creates the referrer's PENDING reward for a purchase that just became
 * PAID. Runs inside the activation transaction; idempotent through the
 * unique `purchaseId` (ON CONFLICT DO NOTHING, which - unlike a caught
 * unique violation - does not abort the surrounding Postgres transaction).
 * The commission is on what the buyer actually paid, after any coupon.
 */
export async function createReferralRewardForPurchase(
  tx: Prisma.TransactionClient,
  purchase: { id: string; userId: string; amount: number; currency: string },
): Promise<void> {
  if (!(purchase.amount > 0)) return;
  const buyer = await tx.user.findUnique({ where: { id: purchase.userId }, select: { referredById: true } });
  if (!buyer?.referredById || buyer.referredById === purchase.userId) return;

  const percent = await getReferralCommissionPercent(tx);
  const amount = roundCurrency((purchase.amount * percent) / 100);
  if (!(amount > 0)) return;

  const created = await tx.referralReward.createMany({
    data: [{ referrerId: buyer.referredById, referredUserId: purchase.userId, purchaseId: purchase.id, percent, amount, currency: purchase.currency }],
    skipDuplicates: true,
  });
  if (created.count === 0) return;

  await logAudit(
    { actorId: null, action: "REFERRAL_REWARD_CREATED", targetType: "Purchase", targetId: purchase.id, after: { referrerId: buyer.referredById, percent, amount, currency: purchase.currency } },
    tx,
  );
  await notifyUser(
    {
      userId: buyer.referredById,
      title: "Referral reward earned",
      message: `Someone you invited bought a challenge. You earned ${purchase.currency} ${amount.toFixed(2)} (pending approval).`,
      type: "success",
      link: "/referrals",
    },
    tx,
  );
}

/**
 * Called in the refund/cancel transaction of a purchase: its referral reward
 * is voided unless it was already paid out, in which case it is only
 * annotated and flagged for finance to recover manually.
 */
export async function voidReferralRewardForPurchase(tx: Prisma.TransactionClient, purchaseId: string, actorId: string, reason: "PURCHASE_REFUNDED" | "PURCHASE_CANCELLED") {
  const reward = await tx.referralReward.findUnique({ where: { purchaseId } });
  if (!reward || reward.status === "VOID") return;

  if (reward.status === "PAID") {
    await tx.referralReward.update({ where: { id: reward.id }, data: { note: appendNote(reward.note, `${reason} after the reward was paid - recover manually`) } });
    await logAudit({ actorId, action: "REFERRAL_REWARD_PAID_BUT_PURCHASE_REVERSED", targetType: "ReferralReward", targetId: reward.id, after: { purchaseId, reason, amount: reward.amount } }, tx);
    void alertOps(`Referral reward ${reward.id} (ETB ${reward.amount.toFixed(2)}) was already paid but purchase ${purchaseId} was ${reason === "PURCHASE_REFUNDED" ? "refunded" : "cancelled"}`);
    return;
  }

  const claim = await tx.referralReward.updateMany({
    where: { id: reward.id, status: { in: ["PENDING", "APPROVED"] } },
    data: { status: "VOID", voidedAt: new Date(), note: appendNote(reward.note, reason) },
  });
  if (claim.count === 1) {
    await logAudit({ actorId, action: "REFERRAL_REWARD_VOIDED", targetType: "ReferralReward", targetId: reward.id, before: { status: reward.status }, after: { status: "VOID", reason } }, tx);
  }
}

function appendNote(existing: string | null, line: string): string {
  return (existing ? `${existing}\n${line}` : line).slice(0, 2000);
}

// ---------------------------------------------------------------------------
// Admin: maker-checker payout of rewards
// ---------------------------------------------------------------------------

export async function listReferralRewards(params: { page: number; pageSize: number; status?: ReferralRewardStatus | "ALL" }) {
  const where: Prisma.ReferralRewardWhereInput = {};
  if (params.status && params.status !== "ALL") where.status = params.status;
  const [items, total, totals] = await Promise.all([
    prisma.referralReward.findMany({
      where,
      include: {
        referrer: { select: { id: true, name: true, email: true, phone: true } },
        referredUser: { select: { id: true, name: true } },
        purchase: { select: { id: true, amount: true, status: true, template: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.referralReward.count({ where }),
    prisma.referralReward.groupBy({ by: ["status"], _sum: { amount: true }, _count: { _all: true } }),
  ]);
  const summary = Object.fromEntries(totals.map((t) => [t.status, { amount: roundCurrency(t._sum.amount ?? 0), count: t._count._all }]));
  return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.max(1, Math.ceil(total / params.pageSize)), summary };
}

export type ReferralRewardAction = "APPROVE" | "PAY" | "VOID";

/**
 * Maker-checker state machine (mirrors payouts):
 *   PENDING  --APPROVE--> APPROVED   (approver ≠ referrer)
 *   APPROVED --PAY------> PAID       (payer ≠ approver, ≠ referrer; records the transfer reference and a ledger debit)
 *   PENDING|APPROVED --VOID--> VOID  (reason required)
 * Each transition is claimed with a compare-and-swap so two admins clicking
 * at once cannot double-apply it.
 */
export async function decideReferralReward(id: string, action: ReferralRewardAction, actorId: string, opts: { note?: string; providerRef?: string } = {}) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.referralReward.findUniqueOrThrow({ where: { id } });
    if (before.referrerId === actorId) throw new AuthError("You cannot decide your own referral reward", 403);
    const now = new Date();

    let from: ReferralRewardStatus[];
    let data: Prisma.ReferralRewardUpdateManyMutationInput;
    switch (action) {
      case "APPROVE":
        from = ["PENDING"];
        data = { status: "APPROVED", approvedById: actorId, approvedAt: now, ...(opts.note ? { note: appendNote(before.note, opts.note) } : {}) };
        break;
      case "PAY": {
        if (before.status !== "APPROVED") throw new ConflictError("A reward must be approved before it is marked paid");
        if (before.approvedById === actorId) throw new AuthError("The admin who approved a reward cannot mark it paid", 403);
        from = ["APPROVED"];
        const line = [opts.providerRef ? `Paid ref ${opts.providerRef}` : null, opts.note ?? null].filter(Boolean).join(" · ");
        data = { status: "PAID", paidById: actorId, paidAt: now, ...(line ? { note: appendNote(before.note, line) } : {}) };
        break;
      }
      case "VOID":
        if (!opts.note?.trim()) throw new ConflictError("A reason is required to void a reward");
        from = ["PENDING", "APPROVED"];
        data = { status: "VOID", voidedAt: now, note: appendNote(before.note, `Voided: ${opts.note.trim()}`) };
        break;
    }

    if (!from.includes(before.status)) throw new ConflictError(`This reward is already ${before.status.toLowerCase()}`);
    const claim = await tx.referralReward.updateMany({ where: { id, status: { in: from } }, data });
    if (claim.count === 0) throw new ConflictError("This reward was updated by someone else; refresh and try again");

    if (action === "PAY") {
      await tx.ledgerEntry.createMany({
        data: [{ userId: before.referrerId, type: "ADJUSTMENT", amount: -before.amount, currency: before.currency, refType: "ReferralReward", refId: before.id, note: opts.providerRef ?? "referral reward" }],
        skipDuplicates: true,
      });
    }

    const status = action === "APPROVE" ? "APPROVED" : action === "PAY" ? "PAID" : "VOID";
    await logAudit(
      {
        actorId,
        action: `REFERRAL_REWARD_${status}`,
        targetType: "ReferralReward",
        targetId: id,
        before: { status: before.status, amount: before.amount, referrerId: before.referrerId },
        after: { status, note: opts.note ?? null, providerRef: opts.providerRef ?? null },
      },
      tx,
    );

    if (action !== "VOID") {
      await notifyUser(
        {
          userId: before.referrerId,
          title: action === "PAY" ? "Referral reward paid" : "Referral reward approved",
          message:
            action === "PAY"
              ? `${before.currency} ${before.amount.toFixed(2)} referral reward has been sent to you.`
              : `Your ${before.currency} ${before.amount.toFixed(2)} referral reward was approved and will be paid shortly.`,
          type: "success",
          link: "/referrals",
        },
        tx,
      );
    }

    return tx.referralReward.findUniqueOrThrow({ where: { id } });
  });
}

// ---------------------------------------------------------------------------
// Trader
// ---------------------------------------------------------------------------

export async function getReferralOverview(userId: string) {
  const [code, signups, payingReferrals, totals, rewards, percent] = await Promise.all([
    getOrCreateReferralCode(userId),
    prisma.user.count({ where: { referredById: userId } }),
    prisma.user.count({ where: { referredById: userId, purchases: { some: { status: "PAID", amount: { gt: 0 } } } } }),
    prisma.referralReward.groupBy({ by: ["status"], where: { referrerId: userId }, _sum: { amount: true } }),
    prisma.referralReward.findMany({
      where: { referrerId: userId },
      select: { id: true, amount: true, currency: true, percent: true, status: true, createdAt: true, paidAt: true, referredUser: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    getReferralCommissionPercent(),
  ]);
  const sum = (s: ReferralRewardStatus) => roundCurrency(totals.find((t) => t.status === s)?._sum.amount ?? 0);
  return {
    code,
    percent,
    signups,
    payingReferrals,
    earnings: { pending: sum("PENDING"), approved: sum("APPROVED"), paid: sum("PAID") },
    // Referred traders are shown by first name + initial only.
    rewards: rewards.map(({ referredUser, ...r }) => ({ ...r, referredName: maskDisplayName(referredUser.name) })),
  };
}
