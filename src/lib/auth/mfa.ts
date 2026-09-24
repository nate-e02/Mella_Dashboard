import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import bcrypt from "bcrypt";

/**
 * TOTP multi-factor authentication (RFC 6238, 30 s / 6 digits). The shared
 * secret is stored encrypted with AES-256-GCM under a key derived from
 * MFA_ENCRYPTION_KEY (or JWT_SECRET); backup codes are stored bcrypt-hashed.
 */

const ISSUER = "MellaFx";

function encryptionKey(): Buffer {
  const material = process.env.MFA_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!material) throw new Error("MFA_ENCRYPTION_KEY / JWT_SECRET is not configured");
  return createHash("sha256").update(`${material}:mfa`).digest();
}

export function encryptSecret(secretBase32: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secretBase32, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ciphertext.toString("base64")}`;
}

export function decryptSecret(encrypted: string): string {
  const [ivB64, tagB64, dataB64] = encrypted.split(".");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

function totpFor(secretBase32: string, label: string) {
  return new OTPAuth.TOTP({ issuer: ISSUER, label, algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secretBase32) });
}

/** Generates a fresh secret and QR code for enrolment. Nothing is persisted here. */
export async function generateMfaEnrolment(accountLabel: string) {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = totpFor(secret.base32, accountLabel);
  const otpauthUrl = totp.toString();
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
  return { secretEnc: encryptSecret(secret.base32), secretBase32: secret.base32, otpauthUrl, qrDataUrl };
}

/** Validates a 6-digit code against the encrypted secret, allowing ±1 step of clock drift. */
export function verifyTotp(secretEnc: string, code: string, accountLabel = "user"): boolean {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const totp = totpFor(decryptSecret(secretEnc), accountLabel);
  return totp.validate({ token: normalized, window: 1 }) !== null;
}

export async function generateBackupCodes(count = 8): Promise<{ plain: string[]; hashes: string[] }> {
  const plain = Array.from({ length: count }, () => randomBytes(5).toString("hex").toUpperCase().replace(/(.{5})/, "$1-"));
  const hashes = await Promise.all(plain.map((c) => bcrypt.hash(c.replace("-", ""), 8)));
  return { plain, hashes };
}

/** Returns the index of the matching (unused) backup code, or -1. */
export async function matchBackupCode(hashes: string[], code: string): Promise<number> {
  const normalized = code.replace(/[\s-]/g, "").toUpperCase();
  for (let i = 0; i < hashes.length; i++) {
    if (hashes[i] && (await bcrypt.compare(normalized, hashes[i]))) return i;
  }
  return -1;
}

/** Persists enablement after the enrolment code was verified. */
export async function enableMfaForUser(userId: string, backupCodeHashes: string[]) {
  const { prisma } = await import("@/lib/prisma");
  await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true, mfaBackupCodes: backupCodeHashes } });
}
