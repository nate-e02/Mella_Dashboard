import "server-only";
import type { Coupon, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError } from "@/lib/errors";
import { logAudit } from "@/lib/services/audit";
import { alertOps } from "@/lib/services/notifications";
import { roundCurrency } from "@/lib/services/calculations";

type Db = Prisma.TransactionClient | typeof prisma;

/** Codes are stored upper-case: letters, digits, "-" and "_", 3–32 characters. */
export const COUPON_CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

/** A PENDING checkout with a coupon holds one of the user's redemptions for this long. */
const PENDING_HOLD_MS = 60 * 60 * 1000;

export type CouponRejectReason = "NOT_FOUND" | "INACTIVE" | "NOT_STARTED" | "EXPIRED" | "EXHAUSTED" | "USER_LIMIT" | "NOT_APPLICABLE";

/** Upper-cases and trims user input; null when it cannot possibly be a coupon code. */
export function normalizeCouponCode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return COUPON_CODE_PATTERN.test(code) ? code : null;
}

/**
 * Discount in ETB for `price`: a percentage or a fixed amount, rounded to
 * cents, never negative and never more than the price itself (so the
 * final amount is always 0 ≤ final ≤ price).
 */
export function computeDiscount(price: number, coupon: Pick<Coupon, "percentOff" | "amountOff">): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  let raw = 0;
  if (coupon.percentOff != null) raw = (price * coupon.percentOff) / 100;
  else if (coupon.amountOff != null) raw = coupon.amountOff;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return roundCurrency(Math.min(raw, price));
}

/** Thrown when a coupon cannot be applied; `reason` is stable and safe to show (translated) to the trader. */
export class CouponError extends ConflictError {
  reason: CouponRejectReason;
  constructor(reason: CouponRejectReason) {
    super(COUPON_REASON_MESSAGES[reason]);
    this.name = "CouponError";
    this.reason = reason;
  }
}

export const COUPON_REASON_MESSAGES: Record<CouponRejectReason, string> = {
  NOT_FOUND: "This coupon code does not exist",
  INACTIVE: "This coupon is no longer active",
  NOT_STARTED: "This coupon is not valid yet",
  EXPIRED: "This coupon has expired",
  EXHAUSTED: "This coupon has been fully redeemed",
  USER_LIMIT: "You have already used this coupon",
  NOT_APPLICABLE: "This coupon does not apply to this challenge",
};

export type CouponValidation =
  | { ok: true; coupon: Coupon; listPrice: number; discount: number; finalAmount: number }
  | { ok: false; reason: CouponRejectReason; listPrice: number | null };

/**
 * Checks whether `code` can be used by `userId` for `templateId` right now
 * and prices it against the template's current database price.
 *
 * Per-user limit: counts this user's PAID purchases with the coupon, plus
 * their PENDING ones from the last hour (an open checkout holds a
 * redemption so a user cannot open several discounted checkouts at once).
 * `excludePurchaseId` leaves out the attempt being re-validated.
 */
export async function validateCoupon(
  params: { code: string; templateId: string; userId: string; excludePurchaseId?: string; now?: Date },
  db: Db = prisma,
): Promise<CouponValidation> {
  const now = params.now ?? new Date();
  const template = await db.template.findUnique({ where: { id: params.templateId }, select: { id: true, price: true, currency: true, status: true, phase: true } });
  const listPrice = template ? template.price : null;

  const code = normalizeCouponCode(params.code);
  if (!code) return { ok: false, reason: "NOT_FOUND", listPrice };
  const coupon = await db.coupon.findUnique({ where: { code } });
  if (!coupon) return { ok: false, reason: "NOT_FOUND", listPrice };
  if (!coupon.active) return { ok: false, reason: "INACTIVE", listPrice };
  if (coupon.validFrom && coupon.validFrom.getTime() > now.getTime()) return { ok: false, reason: "NOT_STARTED", listPrice };
  if (coupon.validUntil && coupon.validUntil.getTime() <= now.getTime()) return { ok: false, reason: "EXPIRED", listPrice };

  if (
    !template ||
    template.status !== "ACTIVE" ||
    template.phase !== "PHASE_1" ||
    !(template.price > 0) ||
    template.currency !== coupon.currency ||
    (coupon.templateIds.length > 0 && !coupon.templateIds.includes(template.id))
  ) {
    return { ok: false, reason: "NOT_APPLICABLE", listPrice };
  }

  if (coupon.maxRedemptions != null && coupon.redeemedCount >= coupon.maxRedemptions) {
    return { ok: false, reason: "EXHAUSTED", listPrice };
  }

  const used = await db.purchase.count({
    where: {
      userId: params.userId,
      couponId: coupon.id,
      ...(params.excludePurchaseId ? { id: { not: params.excludePurchaseId } } : {}),
      OR: [{ status: "PAID" }, { status: "PENDING", createdAt: { gte: new Date(now.getTime() - PENDING_HOLD_MS) } }],
    },
  });
  if (used >= coupon.perUserLimit) return { ok: false, reason: "USER_LIMIT", listPrice };

  const discount = computeDiscount(template.price, coupon);
  return { ok: true, coupon, listPrice: template.price, discount, finalAmount: roundCurrency(template.price - discount) };
}

/**
 * Counts a redemption when a purchase that used a coupon becomes PAID. Runs
 * inside the activation transaction, after the purchase row was claimed
 * PAID, so the counter can never drift from the purchases it counts.
 *
 * - Free (0 ETB) redemptions are the only ones we may still refuse: the
 *   increment is conditional (`redeemedCount < maxRedemptions`), which also
 *   takes the coupon row lock, so the per-user count that follows sees every
 *   concurrent redemption that committed first. Throwing a CouponError here
 *   rolls the whole activation back.
 * - A Chapa-paid purchase is never refused after the money moved: the
 *   redemption is counted unconditionally and an over-redemption is audited
 *   and flagged to ops instead.
 */
export async function recordCouponRedemption(
  tx: Prisma.TransactionClient,
  purchase: { id: string; userId: string; couponId: string | null; amount: number },
): Promise<void> {
  if (!purchase.couponId) return;
  const coupon = await tx.coupon.findUnique({ where: { id: purchase.couponId } });
  if (!coupon) return;
  const free = purchase.amount <= 0;

  if (free && coupon.maxRedemptions != null) {
    const claim = await tx.coupon.updateMany({
      where: { id: coupon.id, redeemedCount: { lt: coupon.maxRedemptions } },
      data: { redeemedCount: { increment: 1 } },
    });
    if (claim.count === 0) throw new CouponError("EXHAUSTED");
  } else {
    await tx.coupon.update({ where: { id: coupon.id }, data: { redeemedCount: { increment: 1 } } });
  }

  const [after, userRedemptions] = await Promise.all([
    tx.coupon.findUniqueOrThrow({ where: { id: coupon.id }, select: { redeemedCount: true, maxRedemptions: true, perUserLimit: true, code: true } }),
    tx.purchase.count({ where: { userId: purchase.userId, couponId: coupon.id, status: "PAID" } }),
  ]);

  if (free && userRedemptions > after.perUserLimit) throw new CouponError("USER_LIMIT");

  const overTotal = after.maxRedemptions != null && after.redeemedCount > after.maxRedemptions;
  const overUser = userRedemptions > after.perUserLimit;
  if (overTotal || overUser) {
    // Only reachable for a paid checkout that was opened while the coupon was
    // still available: honour the payment, leave a trail for finance.
    await logAudit(
      {
        actorId: null,
        action: "COUPON_OVER_REDEEMED",
        targetType: "Coupon",
        targetId: coupon.id,
        after: { purchaseId: purchase.id, code: after.code, redeemedCount: after.redeemedCount, maxRedemptions: after.maxRedemptions, userRedemptions, perUserLimit: after.perUserLimit },
      },
      tx,
    );
    void alertOps(`Coupon ${after.code} over-redeemed by paid purchase ${purchase.id} (${after.redeemedCount}/${after.maxRedemptions ?? "∞"}, user ${userRedemptions}/${after.perUserLimit})`);
  }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export type CouponInput = {
  code: string;
  description: string;
  percentOff: number | null;
  amountOff: number | null;
  maxRedemptions: number | null;
  perUserLimit: number;
  templateIds: string[];
  validFrom: Date | null;
  validUntil: Date | null;
  active: boolean;
};

export async function listCoupons(params: { page: number; pageSize: number; search?: string; status?: "ACTIVE" | "INACTIVE" | "ALL" }) {
  const where: Prisma.CouponWhereInput = {};
  if (params.status === "ACTIVE") where.active = true;
  if (params.status === "INACTIVE") where.active = false;
  if (params.search) where.OR = [{ code: { contains: params.search.trim().toUpperCase() } }, { description: { contains: params.search, mode: "insensitive" } }];
  const [items, total] = await Promise.all([
    prisma.coupon.findMany({
      where,
      include: { _count: { select: { purchases: true } } },
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.coupon.count({ where }),
  ]);
  return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) };
}

/** Business invariants shared by create and update (after merging the patch onto the stored coupon). */
async function assertCouponInvariants(input: CouponInput, db: Db) {
  if ((input.percentOff == null) === (input.amountOff == null)) throw new ConflictError("Set either a percentage or a fixed ETB discount");
  if (input.percentOff != null && !(input.percentOff > 0 && input.percentOff <= 100)) throw new ConflictError("Percentage must be between 0 and 100");
  if (input.amountOff != null && !(input.amountOff > 0)) throw new ConflictError("Fixed discount must be greater than 0");
  if (input.validFrom && input.validUntil && input.validUntil.getTime() <= input.validFrom.getTime()) {
    throw new ConflictError("The end date must be after the start date");
  }
  if (input.templateIds.length > 0) {
    const found = await db.template.count({ where: { id: { in: input.templateIds }, phase: "PHASE_1" } });
    if (found !== new Set(input.templateIds).size) throw new ConflictError("Coupons can only be restricted to existing Phase 1 challenges");
  }
}

export async function createCoupon(input: CouponInput, actorId: string) {
  const code = normalizeCouponCode(input.code);
  if (!code) throw new ConflictError("Codes use 3–32 letters, digits, - or _");
  const data = { ...input, code, templateIds: [...new Set(input.templateIds)], amountOff: input.amountOff != null ? roundCurrency(input.amountOff) : null };
  await assertCouponInvariants(data, prisma);
  const existing = await prisma.coupon.findUnique({ where: { code }, select: { id: true } });
  if (existing) throw new ConflictError(`A coupon with code ${code} already exists`);

  return prisma.$transaction(async (tx) => {
    const coupon = await tx.coupon.create({ data: { ...data, currency: "ETB", createdById: actorId } });
    await logAudit({ actorId, action: "COUPON_CREATED", targetType: "Coupon", targetId: coupon.id, after: couponAuditView(coupon) }, tx);
    return coupon;
  });
}

/**
 * Edits a coupon. The code is immutable once any purchase references it (a
 * receipt must keep pointing at the code the trader typed); everything else
 * can change, and only affects checkouts started afterwards - an open
 * checkout keeps the price it was quoted.
 */
export async function updateCoupon(id: string, patch: Partial<CouponInput>, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.coupon.findUniqueOrThrow({ where: { id }, include: { _count: { select: { purchases: true } } } });

    let code = before.code;
    if (patch.code !== undefined) {
      const next = normalizeCouponCode(patch.code);
      if (!next) throw new ConflictError("Codes use 3–32 letters, digits, - or _");
      if (next !== before.code) {
        if (before.redeemedCount > 0 || before._count.purchases > 0) throw new ConflictError("The code cannot be changed after the coupon has been used");
        const clash = await tx.coupon.findUnique({ where: { code: next }, select: { id: true } });
        if (clash) throw new ConflictError(`A coupon with code ${next} already exists`);
        code = next;
      }
    }

    const merged: CouponInput = {
      code,
      description: patch.description ?? before.description,
      percentOff: patch.percentOff !== undefined ? patch.percentOff : before.percentOff,
      amountOff: patch.amountOff !== undefined ? (patch.amountOff != null ? roundCurrency(patch.amountOff) : null) : before.amountOff,
      maxRedemptions: patch.maxRedemptions !== undefined ? patch.maxRedemptions : before.maxRedemptions,
      perUserLimit: patch.perUserLimit ?? before.perUserLimit,
      templateIds: patch.templateIds ? [...new Set(patch.templateIds)] : before.templateIds,
      validFrom: patch.validFrom !== undefined ? patch.validFrom : before.validFrom,
      validUntil: patch.validUntil !== undefined ? patch.validUntil : before.validUntil,
      active: patch.active ?? before.active,
    };
    await assertCouponInvariants(merged, tx);

    const updated = await tx.coupon.update({ where: { id }, data: merged });
    await logAudit(
      { actorId, action: before.active && !updated.active ? "COUPON_DEACTIVATED" : "COUPON_UPDATED", targetType: "Coupon", targetId: id, before: couponAuditView(before), after: couponAuditView(updated) },
      tx,
    );
    return updated;
  });
}

function couponAuditView(c: Coupon) {
  return {
    code: c.code,
    percentOff: c.percentOff,
    amountOff: c.amountOff,
    maxRedemptions: c.maxRedemptions,
    perUserLimit: c.perUserLimit,
    templateIds: c.templateIds,
    validFrom: c.validFrom,
    validUntil: c.validUntil,
    active: c.active,
  };
}
