import "server-only";
import { randomBytes } from "crypto";
import { Prisma, type KycStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/services/audit";
import { dojahKycProvider } from "@/lib/services/dojahKycProvider";
import type { KycProvider, KycSessionConfig } from "@/lib/services/kycProvider";

/**
 * The only place in the application that knows which concrete provider is
 * active. Everything else in this file, and every caller of it, depends on
 * the `KycProvider` interface - switching providers later means changing
 * this one line (and adding the new provider's implementation file), not
 * the state machine, the routes, or the UI's data contract.
 */
const provider: KycProvider = dojahKycProvider;

/** Our own KYC-side outcome states, reusing the existing KycStatus enum:
 * APPROVED/REJECTED already mean exactly VERIFIED/FAILED - see kyc.ts and
 * the admin review flow it already powers. "NOT_STARTED" is represented,
 * as elsewhere in this codebase (see users.ts), by no KycSubmission row
 * existing yet - not a new enum value. */

function isUniqueConstraintOn(err: unknown, field: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    Array.isArray(err.meta?.target) &&
    (err.meta.target as string[]).includes(field)
  );
}

/** True if `err` is a Postgres serialization failure from a concurrent transaction (Prisma P2034). */
function isSerializationFailure(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
}

/** Dojah requires reference_id to be at least 10 characters; never derived from any identity data. */
function generateReferenceId(): string {
  return `mellafx-kyc-${randomBytes(8).toString("hex")}`;
}

export type StartVerificationResult = {
  submissionId: string;
  session: KycSessionConfig;
};

/**
 * Starts (or resumes) a provider-driven KYC verification for the
 * authenticated user.
 *
 * Idempotent against duplicate submit requests: if a PENDING submission
 * from this provider already exists for the user, it's reused (same
 * `providerReference`) instead of creating a second one. The check-then-
 * create is done inside a SERIALIZABLE transaction so two truly concurrent
 * requests (a double-click that slips past the client-side disable, or a
 * network retry) can't both observe "no pending submission" and both
 * insert one - Postgres aborts the loser with a serialization failure,
 * which is caught and retried once, at which point it finds the winner's
 * row and reuses it. No new schema or locking infrastructure is needed for
 * this - it's a built-in Prisma/Postgres transaction isolation level.
 */
export async function startProviderVerification(user: {
  id: string;
  name: string;
  email: string;
}): Promise<StartVerificationResult> {
  let outcome: { submissionId: string; referenceId: string; isNew: boolean };
  try {
    outcome = await prisma.$transaction(
      async (tx) => {
        const existingPending = await tx.kycSubmission.findFirst({
          where: { userId: user.id, provider: provider.name, status: "PENDING" },
          orderBy: { submittedAt: "desc" },
        });
        if (existingPending?.providerReference) {
          return { submissionId: existingPending.id, referenceId: existingPending.providerReference, isNew: false };
        }

        const referenceId = generateReferenceId();
        const submission = await tx.kycSubmission.create({
          data: { userId: user.id, status: "PENDING", provider: provider.name, providerReference: referenceId },
        });

        await logAudit(
          { actorId: user.id, action: "KYC_SUBMITTED", targetType: "KycSubmission", targetId: submission.id, after: { provider: provider.name } },
          tx,
        );

        return { submissionId: submission.id, referenceId, isNew: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (err) {
    if (isSerializationFailure(err) || isUniqueConstraintOn(err, "providerReference")) {
      return startProviderVerification(user);
    }
    throw err;
  }

  let session: KycSessionConfig;
  try {
    session = await provider.createVerificationSession({ referenceId: outcome.referenceId, user });
  } catch (err) {
    if (outcome.isNew) {
      // Never leave a submission behind that can never actually run a
      // verification session (e.g. Dojah isn't configured) - only clean up
      // one we just created, never a reused, genuinely in-progress one.
      await prisma.kycSubmission.delete({ where: { id: outcome.submissionId } }).catch(() => undefined);
    }
    console.error("Failed to create KYC verification session:", err instanceof Error ? err.message : err);
    throw new Error("Unable to start verification. Please try again later.");
  }

  return { submissionId: outcome.submissionId, session };
}

export type HandleWebhookOutcome = { outcome: "VERIFIED" | "FAILED" | "PENDING"; submissionId: string } | { outcome: "IGNORED" };

/**
 * Processes an ALREADY SIGNATURE-VERIFIED provider webhook payload (the
 * caller - the webhook route - must call `provider.verifyWebhookSignature`
 * first and reject the request outright if it fails; this function assumes
 * that has happened and never re-checks it).
 *
 * Idempotent and concurrency-safe: the PENDING -> APPROVED/REJECTED
 * transition is claimed via a conditional `updateMany` inside a
 * transaction (the same compare-and-swap pattern used by the challenge
 * engine and the Chapa payment flow), so repeated/duplicate webhook
 * delivery for the same reference can never double-write the status or
 * double-log the audit event.
 */
export async function handleVerifiedProviderWebhook(rawBody: string): Promise<HandleWebhookOutcome> {
  const parsed = provider.parseWebhookPayload(rawBody);
  if (!parsed) return { outcome: "IGNORED" };

  const submission = await prisma.kycSubmission.findUnique({ where: { providerReference: parsed.referenceId } });
  if (!submission) {
    console.error("KYC webhook received for an unknown providerReference");
    return { outcome: "IGNORED" };
  }

  if (submission.status !== "PENDING") {
    // Already resolved (by a prior webhook delivery, or an admin override) -
    // idempotent no-op, reflects the current state back without re-deciding it.
    return { outcome: submission.status === "APPROVED" ? "VERIFIED" : "FAILED", submissionId: submission.id };
  }

  if (parsed.result.outcome === "PENDING") {
    return { outcome: "PENDING", submissionId: submission.id };
  }

  const newStatus: KycStatus = parsed.result.outcome === "VERIFIED" ? "APPROVED" : "REJECTED";

  return prisma.$transaction(async (tx) => {
    const claim = await tx.kycSubmission.updateMany({
      where: { id: submission.id, status: "PENDING" },
      data: { status: newStatus, reviewedAt: new Date(), failureReason: parsed.result.failureReason ?? null },
    });

    if (claim.count === 1) {
      await logAudit(
        {
          actorId: null,
          action: newStatus === "APPROVED" ? "KYC_VERIFIED" : "KYC_FAILED",
          targetType: "KycSubmission",
          targetId: submission.id,
          before: { status: "PENDING" },
          after: { status: newStatus, provider: provider.name, failureReason: parsed.result.failureReason ?? null },
        },
        tx,
      );
    }

    return { outcome: (newStatus === "APPROVED" ? "VERIFIED" : "FAILED") as "VERIFIED" | "FAILED", submissionId: submission.id };
  });
}

export { provider as activeKycProvider };

// ---------------------------------------------------------------------------
// TEMPORARY DEVELOPMENT KYC OVERRIDE — REMOVE BEFORE PRODUCTION
//
// Everything below this line exists solely so an admin can force a trader's
// KYC status during local development/testing without a real Dojah
// verification. It reuses the existing KycSubmission model and audit-log
// architecture and does not modify the Dojah provider or the real
// webhook-driven verification path above in any way - it can be deleted
// (this function, its route in
// src/app/api/admin/kyc/[id]/override/route.ts, the UI control in
// KycTable.tsx, and tests/kycAdminOverride.integration.test.ts) without
// touching real KYC verification at all. See also the admin UI control,
// which is similarly commented.
// ---------------------------------------------------------------------------

/** TEMPORARY DEVELOPMENT KYC OVERRIDE — REMOVE BEFORE PRODUCTION. */
export async function adminOverrideKycStatus(submissionId: string, newStatus: KycStatus, adminId: string, reason?: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });

    if (before.status === newStatus) {
      // Already at the requested status - idempotent no-op, no duplicate audit entry.
      return before;
    }

    const updated = await tx.kycSubmission.update({
      where: { id: submissionId },
      data: {
        status: newStatus,
        reviewedAt: newStatus === "PENDING" ? null : new Date(),
        reviewerId: newStatus === "PENDING" ? null : adminId,
        failureReason: newStatus === "REJECTED" ? (reason ?? "manual_admin_override") : null,
      },
    });

    await logAudit(
      {
        actorId: adminId,
        action: "KYC_ADMIN_OVERRIDE",
        targetType: "KycSubmission",
        targetId: submissionId,
        before: { status: before.status },
        // Explicitly marked so this can never be confused with a real,
        // provider-verified KYC_VERIFIED/KYC_FAILED audit event.
        after: { status: newStatus, reason: reason ?? null, note: "MANUAL ADMIN OVERRIDE - development only, not a real Dojah verification" },
      },
      tx,
    );

    return updated;
  });
}
