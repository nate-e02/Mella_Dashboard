import "server-only";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Replay protection for provider webhooks. Each delivery is identified by the
 * provider's event id when it has one, otherwise by a hash of the raw body.
 * Returns false when this exact delivery has already been processed.
 */
export async function claimWebhookDelivery(provider: string, rawBody: string, eventId?: string | null): Promise<boolean> {
  const id = eventId && eventId.length > 0 ? eventId : createHash("sha256").update(rawBody).digest("hex");
  try {
    await prisma.webhookDelivery.create({ data: { provider, eventId: id } });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}
