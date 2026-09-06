import "server-only";
import { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { toTemplateSnapshot, type TemplateSnapshot } from "@/types";
import { logAudit } from "@/lib/services/audit";
import { ConflictError } from "@/lib/auth/guards";
import { roundCurrency } from "@/lib/services/calculations";
import { CHAPA_CURRENCY, initializeChapaTransaction, verifyChapaTransaction } from "@/lib/services/chapa";

function isUniqueConstraintOn(err: unknown, field: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    Array.isArray(err.meta?.target) &&
    (err.meta.target as string[]).includes(field)
  );
}

/** Collision-resistant, non-sensitive reference used to look up a payment attempt by tx_ref. */
function generateTxRef(): string {
  return `mellafx-${Date.now()}-${randomBytes(8).toString("hex")}`;
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Trader", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function getAppUrl(): string {
  return process.env.APP_URL || "http://localhost:3000";
}

function chapaUrls(txRef: string) {
  const base = getAppUrl();
  return {
    callbackUrl: `${base}/api/payments/chapa/webhook`,
    returnUrl: `${base}/api/payments/chapa/return?tx_ref=${encodeURIComponent(txRef)}`,
  };
}

export type InitiatePurchaseResult =
  | { outcome: "REDIRECT"; purchaseId: string; checkoutUrl: string }
  | { outcome: "ALREADY_PAID"; purchaseId: string };

/**
 * Starts a real Chapa payment for a Phase 1 template.
 *
 * The amount charged is ALWAYS the template's current database price -
 * nothing from the caller/client is trusted for pricing. This only creates
 * a PENDING Purchase and a Chapa checkout session; the existing
 * TradingAccount-creation logic does not run here. It only runs once the
 * payment is verified successful, in `activatePurchase` - see
 * `verifyAndCompleteChapaPurchase`.
 *
 * Idempotency: the caller (the Challenges page) generates one
 * `idempotencyKey` per purchase attempt (i.e. once per "Pay" click) and
 * resends the same key on retry. A retry for a PENDING/FAILED attempt
 * re-initializes the same Chapa tx_ref (getting a fresh checkout session
 * without creating a second local Purchase); a retry for an already-PAID
 * attempt is reported back as such instead of charging again.
 */
export async function initiateChapaPurchase(
  user: { id: string; name: string; email: string },
  templateId: string,
  idempotencyKey?: string,
): Promise<InitiatePurchaseResult> {
  if (idempotencyKey) {
    const existing = await prisma.purchase.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.userId !== user.id) throw new ConflictError("This request has already been processed");
      if (existing.status === "PAID") return { outcome: "ALREADY_PAID", purchaseId: existing.id };
      if (existing.status === "REFUNDED" || existing.status === "CANCELLED") {
        throw new ConflictError("This purchase attempt is no longer available");
      }

      // PENDING or FAILED: retry with the same tx_ref rather than creating a
      // second Purchase row for the same logical attempt.
      const { firstName, lastName } = splitName(user.name);
      const { checkoutUrl } = await initializeChapaTransaction({
        amount: existing.amount,
        txRef: existing.providerTxRef,
        email: user.email,
        firstName,
        lastName,
        ...chapaUrls(existing.providerTxRef),
      });
      if (existing.status === "FAILED") {
        await prisma.purchase.updateMany({ where: { id: existing.id, status: "FAILED" }, data: { status: "PENDING" } });
      }
      return { outcome: "REDIRECT", purchaseId: existing.id, checkoutUrl };
    }
  }

  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) throw new Error("Template not found");
  if (template.status !== "ACTIVE") throw new Error("This challenge is no longer available for purchase");
  if (template.phase !== "PHASE_1") throw new Error("Only Phase 1 challenges can be purchased directly");

  const snapshot = toTemplateSnapshot(template);
  const txRef = generateTxRef();

  let purchase;
  try {
    purchase = await prisma.purchase.create({
      data: {
        userId: user.id,
        templateId: template.id,
        status: "PENDING",
        // Authoritative price straight from the database - never from the
        // client. Chapa currency is fixed to ETB; no conversion is performed.
        amount: template.price,
        currency: CHAPA_CURRENCY,
        providerTxRef: txRef,
        idempotencyKey: idempotencyKey ?? null,
        snapshot: snapshot as never,
      },
    });
  } catch (err) {
    if (idempotencyKey && isUniqueConstraintOn(err, "idempotencyKey")) {
      // Lost a race against another concurrent request with the same key
      // (e.g. a double-click) that already inserted the Purchase row -
      // retry the whole call so it takes the "existing" branch above.
      return initiateChapaPurchase(user, templateId, idempotencyKey);
    }
    throw err;
  }

  const { firstName, lastName } = splitName(user.name);

  let checkoutUrl: string;
  try {
    const result = await initializeChapaTransaction({
      amount: purchase.amount,
      txRef,
      email: user.email,
      firstName,
      lastName,
      ...chapaUrls(txRef),
    });
    checkoutUrl = result.checkoutUrl;
  } catch (err) {
    // Never leave a purchase silently PENDING forever if Chapa refused to
    // create a session for it at all.
    await prisma.purchase.updateMany({ where: { id: purchase.id, status: "PENDING" }, data: { status: "FAILED" } });
    console.error("Chapa initialize failed for purchase", purchase.id, err instanceof Error ? err.message : err);
    throw new Error("Unable to start payment. Please try again.");
  }

  await logAudit({
    actorId: user.id,
    action: "CHAPA_PAYMENT_INITIATED",
    targetType: "Purchase",
    targetId: purchase.id,
    after: { templateId: template.id, amount: purchase.amount, currency: purchase.currency, txRef },
  });

  return { outcome: "REDIRECT", purchaseId: purchase.id, checkoutUrl };
}

type ActivationSource = { source: "CHAPA" } | { source: "ADMIN_TEST"; adminId: string };

/**
 * Marks a Purchase PAID and runs the existing TradingAccount-creation logic
 * for it - the single place that turns a completed payment into an active
 * challenge. Used identically by a verified Chapa payment and by the
 * admin-only test-paid action, so both produce exactly the same resulting
 * state.
 *
 * Idempotent and concurrency-safe: the PENDING/FAILED -> PAID transition is
 * claimed atomically via a conditional `updateMany` inside a transaction
 * (the same compare-and-swap pattern used by the challenge engine), so if
 * this is called twice for the same purchase - two webhook deliveries, a
 * webhook racing the browser callback, or a double click on the admin
 * button - only the first call performs the transition and creates the
 * account; every other call is a no-op that returns the existing result.
 */
export async function activatePurchase(purchaseId: string, activation: ActivationSource) {
  return prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.findUniqueOrThrow({
      where: { id: purchaseId },
      include: { tradingAccount: true },
    });

    if (purchase.status === "PAID") {
      return { purchase, account: purchase.tradingAccount };
    }
    if (purchase.status === "REFUNDED" || purchase.status === "CANCELLED") {
      throw new ConflictError(`Cannot activate a purchase with status ${purchase.status}`);
    }

    const claim = await tx.purchase.updateMany({
      where: { id: purchaseId, status: purchase.status },
      data: { status: "PAID", paymentDate: new Date() },
    });

    if (claim.count === 0) {
      // Lost a race to another concurrent activation - return what the
      // winner already created instead of creating a second account.
      const current = await tx.purchase.findUniqueOrThrow({
        where: { id: purchaseId },
        include: { tradingAccount: true },
      });
      return { purchase: current, account: current.tradingAccount };
    }

    const snapshot = purchase.snapshot as unknown as TemplateSnapshot;

    let account = purchase.tradingAccount;
    if (!account) {
      try {
        account = await tx.tradingAccount.create({
          data: {
            userId: purchase.userId,
            purchaseId: purchase.id,
            templateId: purchase.templateId,
            snapshot: purchase.snapshot as never,
            phase: snapshot.phase,
            status: "ACTIVE",
            startingBalance: snapshot.startingBalance,
            balance: snapshot.startingBalance,
            equity: snapshot.startingBalance,
            highWaterMark: snapshot.startingBalance,
            dailyAnchorBalance: snapshot.startingBalance,
          },
        });
      } catch (err) {
        if (isUniqueConstraintOn(err, "purchaseId")) {
          account = await tx.tradingAccount.findUniqueOrThrow({ where: { purchaseId: purchase.id } });
        } else {
          throw err;
        }
      }
    }

    await logAudit(
      {
        actorId: activation.source === "ADMIN_TEST" ? activation.adminId : null,
        action: activation.source === "ADMIN_TEST" ? "PURCHASE_MARKED_PAID_BY_ADMIN_TEST" : "CHAPA_PAYMENT_VERIFIED",
        targetType: "Purchase",
        targetId: purchase.id,
        after: { accountId: account.id, source: activation.source },
      },
      tx,
    );

    const updatedPurchase = await tx.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
    return { purchase: updatedPurchase, account };
  });
}

/** Flips a still-PENDING purchase to FAILED; a no-op for any other status. */
async function markPurchaseFailed(purchaseId: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
    if (before.status !== "PENDING") return;

    const claim = await tx.purchase.updateMany({ where: { id: purchaseId, status: "PENDING" }, data: { status: "FAILED" } });
    if (claim.count === 1) {
      await logAudit(
        {
          actorId: null,
          action: "CHAPA_PAYMENT_FAILED",
          targetType: "Purchase",
          targetId: purchaseId,
          before: { status: before.status },
          after: { status: "FAILED", reason },
        },
        tx,
      );
    }
  });
}

export type VerifyAndCompleteResult =
  | { outcome: "PAID" | "ALREADY_PAID"; purchaseId: string }
  | { outcome: "PENDING" | "FAILED" | "TERMINAL"; purchaseId: string }
  | { outcome: "NOT_FOUND" };

/**
 * The single entry point both the Chapa return/callback route and the
 * webhook route call. Never trusts the browser redirect or the webhook
 * payload's own claimed status - always re-verifies directly with Chapa,
 * then cross-checks amount/currency/tx_ref against our local record before
 * calling `activatePurchase`. Safe to call repeatedly for the same tx_ref
 * (see `activatePurchase`'s idempotency).
 */
export async function verifyAndCompleteChapaPurchase(providerTxRef: string): Promise<VerifyAndCompleteResult> {
  const purchase = await prisma.purchase.findUnique({ where: { providerTxRef } });
  if (!purchase) {
    console.error("Chapa verification requested for unknown tx_ref:", providerTxRef);
    return { outcome: "NOT_FOUND" };
  }

  if (purchase.status === "PAID") return { outcome: "ALREADY_PAID", purchaseId: purchase.id };
  if (purchase.status === "REFUNDED" || purchase.status === "CANCELLED") {
    return { outcome: "TERMINAL", purchaseId: purchase.id };
  }

  let verification;
  try {
    verification = await verifyChapaTransaction(providerTxRef);
  } catch (err) {
    console.error("Chapa verification request failed for purchase", purchase.id, err instanceof Error ? err.message : err);
    return { outcome: "PENDING", purchaseId: purchase.id };
  }

  if (verification.paymentStatus === "pending") {
    return { outcome: "PENDING", purchaseId: purchase.id };
  }

  const amountMatches = roundCurrency(verification.amount) === roundCurrency(purchase.amount);
  const currencyMatches = verification.currency === purchase.currency;
  const refMatches = verification.txRef === purchase.providerTxRef;

  if (verification.paymentStatus !== "success" || !amountMatches || !currencyMatches || !refMatches) {
    if (verification.paymentStatus === "success" && (!amountMatches || !currencyMatches || !refMatches)) {
      // A "successful" payment that doesn't match our local record is
      // treated as a hard failure, not activated under any circumstance.
      console.error("Chapa verification mismatch for purchase", purchase.id, {
        expectedAmount: purchase.amount,
        gotAmount: verification.amount,
        expectedCurrency: purchase.currency,
        gotCurrency: verification.currency,
        expectedRef: purchase.providerTxRef,
        gotRef: verification.txRef,
      });
    }
    await markPurchaseFailed(purchase.id, verification.paymentStatus);
    return { outcome: "FAILED", purchaseId: purchase.id };
  }

  await activatePurchase(purchase.id, { source: "CHAPA" });
  return { outcome: "PAID", purchaseId: purchase.id };
}

export async function listPurchasesForUser(userId: string) {
  return prisma.purchase.findMany({
    where: { userId },
    include: { template: true, tradingAccount: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function refundPurchase(purchaseId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
    if (before.status !== "PAID") {
      throw new ConflictError(`Cannot refund a purchase with status ${before.status}`);
    }

    const updated = await tx.purchase.update({
      where: { id: purchaseId },
      data: { status: "REFUNDED", refundedAt: new Date() },
    });
    await logAudit(
      {
        actorId,
        action: "PURCHASE_REFUNDED",
        targetType: "Purchase",
        targetId: purchaseId,
        before: { status: before.status },
        after: { status: updated.status },
      },
      tx,
    );
    return updated;
  });
}

export async function cancelPurchase(purchaseId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
    if (before.status !== "PAID" && before.status !== "PENDING") {
      throw new ConflictError(`Cannot cancel a purchase with status ${before.status}`);
    }

    const updated = await tx.purchase.update({
      where: { id: purchaseId },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    await logAudit(
      {
        actorId,
        action: "PURCHASE_CANCELLED",
        targetType: "Purchase",
        targetId: purchaseId,
        before: { status: before.status },
        after: { status: updated.status },
      },
      tx,
    );
    return updated;
  });
}
