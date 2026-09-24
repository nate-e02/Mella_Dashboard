import "server-only";
import { createHash, randomBytes } from "crypto";
import type { VerificationTokenType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Single-use, expiring tokens for email verification, password reset and
 * phone OTPs. Only the SHA-256 of the token is stored; the raw token goes to
 * the user once and is never logged.
 */

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function createVerificationToken(userId: string, type: VerificationTokenType, ttlMinutes: number, opts: { numeric?: boolean } = {}) {
  const raw = opts.numeric ? String(100000 + Math.floor(Math.random() * 900000)) : randomBytes(32).toString("hex");
  // Invalidate any previous unused token of the same type for this user.
  await prisma.verificationToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
  await prisma.verificationToken.create({
    data: { userId, type, tokenHash: hashToken(opts.numeric ? `${userId}:${raw}` : raw), expiresAt: new Date(Date.now() + ttlMinutes * 60_000) },
  });
  return raw;
}

/**
 * Atomically consumes a token: returns the owning userId if it existed, was
 * unused and unexpired; null otherwise. A second call with the same token
 * always returns null.
 */
export async function consumeVerificationToken(raw: string, type: VerificationTokenType, opts: { userIdForNumeric?: string } = {}): Promise<string | null> {
  const tokenHash = hashToken(opts.userIdForNumeric ? `${opts.userIdForNumeric}:${raw}` : raw);
  const token = await prisma.verificationToken.findUnique({ where: { tokenHash } });
  if (!token || token.type !== type || token.usedAt || token.expiresAt.getTime() < Date.now()) return null;
  const claim = await prisma.verificationToken.updateMany({ where: { id: token.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claim.count === 0) return null;
  return token.userId;
}
