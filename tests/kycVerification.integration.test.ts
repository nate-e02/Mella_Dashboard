import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import { prisma } from "@/lib/prisma";
import { startProviderVerification, handleVerifiedProviderWebhook } from "@/lib/services/kycVerification";
import { TestFixtures } from "./helpers/fixtures";

const SECRET = "test-dojah-secret-key";

beforeEach(() => {
  process.env.DOJAH_APP_ID = "app-1";
  process.env.DOJAH_PUBLIC_KEY = "pub-1";
  process.env.DOJAH_SECRET_KEY = SECRET;
  process.env.DOJAH_WIDGET_ID = "widget-1";
});

const fixtures = new TestFixtures();
afterEach(() => fixtures.cleanup());

function traderUser(user: { id: string; name: string; email: string }) {
  return { id: user.id, name: user.name, email: user.email };
}

function dojahWebhookBody(payload: Record<string, unknown>) {
  return JSON.stringify(payload);
}

function verifiedPayload(referenceId: string) {
  return dojahWebhookBody({ reference_id: referenceId, verification_status: "Completed", status: true });
}

function failedPayload(referenceId: string, extra: Record<string, unknown> = {}) {
  return dojahWebhookBody({ reference_id: referenceId, verification_status: "Completed", status: false, ...extra });
}

function pendingPayload(referenceId: string) {
  return dojahWebhookBody({ reference_id: referenceId, verification_status: "Ongoing", status: false });
}

describe("startProviderVerification", () => {
  it("creates a PENDING KycSubmission with a unique providerReference and returns a client session", async () => {
    const user = await fixtures.createUser();

    const result = await startProviderVerification(traderUser(user));

    const submission = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: result.submissionId } });
    expect(submission.status).toBe("PENDING");
    expect(submission.provider).toBe("DOJAH");
    expect(submission.providerReference).toBeTruthy();
    expect(result.session).toMatchObject({ appId: "app-1", publicKey: "pub-1", widgetId: "widget-1" });
  });

  it("does not collect/store identity fields upfront - only the provider reference", async () => {
    const user = await fixtures.createUser();
    const result = await startProviderVerification(traderUser(user));
    const submission = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: result.submissionId } });
    expect(submission.fullName).toBeNull();
    expect(submission.country).toBeNull();
    expect(submission.documentType).toBeNull();
  });

  it("is idempotent: a second start request while one is PENDING reuses the same submission", async () => {
    const user = await fixtures.createUser();

    const first = await startProviderVerification(traderUser(user));
    const second = await startProviderVerification(traderUser(user));

    expect(second.submissionId).toBe(first.submissionId);
    const count = await prisma.kycSubmission.count({ where: { userId: user.id } });
    expect(count).toBe(1);
  });

  it("does not create a second submission when start requests race each other concurrently (double-click)", async () => {
    const user = await fixtures.createUser();

    const results = await Promise.allSettled([
      startProviderVerification(traderUser(user)),
      startProviderVerification(traderUser(user)),
      startProviderVerification(traderUser(user)),
    ]);

    for (const r of results) expect(r.status).toBe("fulfilled");
    const count = await prisma.kycSubmission.count({ where: { userId: user.id } });
    expect(count).toBe(1);
  });

  it("starts a genuinely new submission after a prior one was resolved (not stuck reusing an old one)", async () => {
    const user = await fixtures.createUser();
    const first = await startProviderVerification(traderUser(user));
    const submission = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: first.submissionId } });
    await handleVerifiedProviderWebhook(failedPayload(submission.providerReference!));

    const second = await startProviderVerification(traderUser(user));

    expect(second.submissionId).not.toBe(first.submissionId);
    const count = await prisma.kycSubmission.count({ where: { userId: user.id } });
    expect(count).toBe(2);
  });

  it("fails cleanly (no orphaned submission left behind) if Dojah is not configured", async () => {
    delete process.env.DOJAH_WIDGET_ID;
    const user = await fixtures.createUser();

    await expect(startProviderVerification(traderUser(user))).rejects.toThrow(/Unable to start verification/);

    const count = await prisma.kycSubmission.count({ where: { userId: user.id } });
    expect(count).toBe(0);
  });
});

describe("handleVerifiedProviderWebhook - state transitions", () => {
  it("transitions PENDING -> APPROVED (VERIFIED) on a verified webhook", async () => {
    const user = await fixtures.createUser();
    const { submissionId } = await startProviderVerification(traderUser(user));
    const submission = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });

    const result = await handleVerifiedProviderWebhook(verifiedPayload(submission.providerReference!));

    expect(result).toEqual({ outcome: "VERIFIED", submissionId });
    const updated = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    expect(updated.status).toBe("APPROVED");
    expect(updated.reviewerId).toBeNull(); // resolved by the provider, not a human
    expect(updated.reviewedAt).not.toBeNull();
  });

  it("transitions PENDING -> REJECTED (FAILED) on a failed webhook, storing only a safe failure category", async () => {
    const user = await fixtures.createUser();
    const { submissionId } = await startProviderVerification(traderUser(user));
    const submission = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });

    const result = await handleVerifiedProviderWebhook(
      failedPayload(submission.providerReference!, { data: { selfie: { status: false, message: "no match" } } }),
    );

    expect(result).toEqual({ outcome: "FAILED", submissionId });
    const updated = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    expect(updated.status).toBe("REJECTED");
    expect(updated.failureReason).toBe("selfie_verification_failed");
  });

  it("leaves the submission PENDING (does not transition) on an in-progress webhook event", async () => {
    const user = await fixtures.createUser();
    const { submissionId } = await startProviderVerification(traderUser(user));
    const submission = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });

    const result = await handleVerifiedProviderWebhook(pendingPayload(submission.providerReference!));

    expect(result).toEqual({ outcome: "PENDING", submissionId });
    const updated = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    expect(updated.status).toBe("PENDING");
  });

  it("does not mark a user verified merely because a webhook request was received - only a genuine Completed+status:true payload verifies", async () => {
    const user = await fixtures.createUser();
    const { submissionId } = await startProviderVerification(traderUser(user));
    const submission = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });

    // An "Ongoing" event must never itself flip status to APPROVED.
    await handleVerifiedProviderWebhook(pendingPayload(submission.providerReference!));

    const updated = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    expect(updated.status).toBe("PENDING");
  });

  it("ignores a webhook for an unknown reference_id without throwing", async () => {
    const result = await handleVerifiedProviderWebhook(verifiedPayload("does-not-exist"));
    expect(result).toEqual({ outcome: "IGNORED" });
  });

  it("ignores a malformed payload without throwing", async () => {
    const result = await handleVerifiedProviderWebhook("not valid json");
    expect(result).toEqual({ outcome: "IGNORED" });
  });

  it("rejects an invalid transition attempt implicitly: a PENDING-only webhook can never move an already-terminal submission", async () => {
    const user = await fixtures.createUser();
    const { submissionId } = await startProviderVerification(traderUser(user));
    const submission = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    await handleVerifiedProviderWebhook(verifiedPayload(submission.providerReference!)); // -> APPROVED

    const result = await handleVerifiedProviderWebhook(failedPayload(submission.providerReference!)); // late/duplicate delivery

    expect(result).toEqual({ outcome: "VERIFIED", submissionId }); // reflects current state, does not flip to FAILED
    const updated = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    expect(updated.status).toBe("APPROVED");
  });
});

describe("handleVerifiedProviderWebhook - idempotency", () => {
  it("does not double-apply or double-log a repeated (duplicate) webhook delivery for the same result", async () => {
    const user = await fixtures.createUser();
    const { submissionId } = await startProviderVerification(traderUser(user));
    const submission = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    const payload = verifiedPayload(submission.providerReference!);

    await handleVerifiedProviderWebhook(payload);
    const second = await handleVerifiedProviderWebhook(payload);

    expect(second).toEqual({ outcome: "VERIFIED", submissionId });
    const logs = await prisma.auditLog.findMany({ where: { targetType: "KycSubmission", targetId: submissionId, action: "KYC_VERIFIED" } });
    expect(logs).toHaveLength(1);
  });

  it("does not create conflicting state when duplicate webhook deliveries race each other concurrently", async () => {
    const user = await fixtures.createUser();
    const { submissionId } = await startProviderVerification(traderUser(user));
    const submission = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    const payload = verifiedPayload(submission.providerReference!);

    const results = await Promise.allSettled([
      handleVerifiedProviderWebhook(payload),
      handleVerifiedProviderWebhook(payload),
      handleVerifiedProviderWebhook(payload),
      handleVerifiedProviderWebhook(payload),
    ]);

    for (const r of results) expect(r.status).toBe("fulfilled");
    const updated = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    expect(updated.status).toBe("APPROVED");
    const logs = await prisma.auditLog.findMany({ where: { targetType: "KycSubmission", targetId: submissionId, action: "KYC_VERIFIED" } });
    expect(logs).toHaveLength(1);
  });
});

describe("security - no sensitive data reaches audit logs", () => {
  it("never writes raw identity data, images, or the provider's raw payload into the audit log", async () => {
    const user = await fixtures.createUser();
    const { submissionId } = await startProviderVerification(traderUser(user));
    const submission = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });

    await handleVerifiedProviderWebhook(
      failedPayload(submission.providerReference!, {
        id_url: "https://dojah.io/signed/id.jpg",
        value: "SENSITIVE-FAYDA-1234567890",
        data: { government_data: { status: false, message: "mismatch", data: { full_name: "Jane Doe", id_number: "1234567890" } } },
      }),
    );

    const logs = await prisma.auditLog.findMany({ where: { targetType: "KycSubmission", targetId: submissionId } });
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain("SENSITIVE-FAYDA");
    expect(serialized).not.toContain("Jane Doe");
    expect(serialized).not.toContain("id_url");
    expect(serialized).not.toContain("dojah.io/signed");
  });
});

describe("webhook route-level signature verification", () => {
  it("processes a genuinely signed webhook end-to-end through the real route handler", async () => {
    const { POST } = await import("@/app/api/kyc/dojah/webhook/route");
    const user = await fixtures.createUser();
    const { submissionId } = await startProviderVerification(traderUser(user));
    const submission = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    const body = verifiedPayload(submission.providerReference!);
    const signature = createHmac("sha256", SECRET).update(body).digest("hex");

    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/api/kyc/dojah/webhook", {
      method: "POST",
      headers: { "x-dojah-signature": signature },
      body,
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    const updated = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    expect(updated.status).toBe("APPROVED");
  });

  it("rejects a webhook with an invalid signature through the real route handler, without changing any state", async () => {
    const { POST } = await import("@/app/api/kyc/dojah/webhook/route");
    const user = await fixtures.createUser();
    const { submissionId } = await startProviderVerification(traderUser(user));
    const submission = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    const body = verifiedPayload(submission.providerReference!);

    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://localhost/api/kyc/dojah/webhook", {
      method: "POST",
      headers: { "x-dojah-signature": "invalid" },
      body,
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    const updated = await prisma.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    expect(updated.status).toBe("PENDING"); // unchanged
  });
});
