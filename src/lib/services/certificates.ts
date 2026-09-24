import "server-only";
import { randomBytes } from "crypto";
import type { CertificateType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notifyUser } from "@/lib/services/notifications";
import { roundCurrency } from "@/lib/services/calculations";
import { maskDisplayName } from "@/lib/displayName";
import type { TemplateSnapshot } from "@/types";

type Db = Prisma.TransactionClient | typeof prisma;

const PUBLIC_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
export const CERTIFICATE_PUBLIC_ID_PATTERN = /^[a-z2-7]{12}$/;

/** 12 random base32 characters (60 bits): short enough to share, far too many to guess. */
export function generateCertificatePublicId(): string {
  // 256 is a multiple of 32, so `byte & 31` is unbiased.
  return Array.from(randomBytes(12), (b) => PUBLIC_ID_ALPHABET[b & 31]).join("");
}

export type CertificateMetadata = {
  phase?: string;
  program?: string;
  templateName?: string;
  accountSize?: number;
  accountCurrency?: string;
};

function formatEtb(value: number): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)} ETB`;
}

const PHASE_LABEL: Record<string, string> = { PHASE_1: "Phase 1", PHASE_2: "Phase 2", FUNDED: "Funded" };

/** English title stored on the certificate (the public page renders a translated one from type + metadata). */
export function certificateTitle(type: CertificateType, meta: CertificateMetadata, amount?: number | null): string {
  const account = meta.accountSize ? `${formatEtb(meta.accountSize)}${meta.program ? ` ${meta.program}` : ""}` : (meta.program ?? "");
  switch (type) {
    case "CHALLENGE_PASSED":
      return `${PHASE_LABEL[meta.phase ?? ""] ?? "Challenge"} Passed${account ? ` — ${account}` : ""}`;
    case "FUNDED":
      return `Funded Trader${account ? ` — ${account}` : ""}`;
    case "PAYOUT":
      return `Payout — ${formatEtb(amount ?? 0)}`;
  }
}

export function certificateDedupeKey(type: CertificateType, ref: { accountId?: string | null; payoutId?: string | null }): string {
  const id = type === "PAYOUT" ? ref.payoutId : ref.accountId;
  if (!id) throw new Error(`A ${type} certificate needs ${type === "PAYOUT" ? "a payoutId" : "an accountId"}`);
  return `${type}:${id}`;
}

/**
 * Issues a certificate at most once per achievement (dedupeKey
 * "CHALLENGE_PASSED:<accountId>", "FUNDED:<accountId>", "PAYOUT:<payoutId>")
 * and notifies the trader the first time.
 *
 * Designed to run inside the transaction of the state change it records
 * (pass, funding, payout), so a certificate exists iff the transition
 * committed. Uses `createMany({ skipDuplicates })` - ON CONFLICT DO NOTHING
 * - because a caught unique violation would abort the caller's Postgres
 * transaction.
 */
export async function issueCertificate(
  db: Db,
  params: { type: CertificateType; userId: string; accountId?: string | null; payoutId?: string | null; amount?: number | null },
) {
  const dedupeKey = certificateDedupeKey(params.type, params);
  const existing = await db.certificate.findUnique({ where: { dedupeKey } });
  if (existing) return existing;

  const [user, account] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: params.userId }, select: { name: true } }),
    params.accountId ? db.tradingAccount.findUnique({ where: { id: params.accountId }, select: { snapshot: true, phase: true, startingBalance: true } }) : null,
  ]);
  const snapshot = account?.snapshot as unknown as TemplateSnapshot | undefined;
  const metadata: CertificateMetadata = account
    ? {
        phase: account.phase,
        program: snapshot?.groupName,
        templateName: snapshot?.name,
        accountSize: snapshot?.accountSize ?? account.startingBalance,
        accountCurrency: snapshot?.accountCurrency ?? "ETB",
      }
    : {};
  const amount = params.amount != null ? roundCurrency(params.amount) : null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const created = await db.certificate.createMany({
      data: [
        {
          publicId: generateCertificatePublicId(),
          dedupeKey,
          userId: params.userId,
          accountId: params.accountId ?? null,
          type: params.type,
          title: certificateTitle(params.type, metadata, amount),
          recipientName: maskDisplayName(user.name),
          amount,
          currency: "ETB",
          metadata: metadata as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    });
    const row = await db.certificate.findUnique({ where: { dedupeKey } });
    if (row) {
      if (created.count === 1) {
        await notifyUser(
          {
            userId: params.userId,
            title: "Certificate issued",
            message: `${row.title}. Share it from your Certificates page.`,
            type: "success",
            link: "/certificates",
          },
          db,
        );
      }
      return row;
    }
    // Skipped without a dedupeKey match: the random publicId collided - try another.
  }
  throw new Error("Could not allocate a certificate id");
}

export async function listCertificatesForUser(userId: string) {
  return prisma.certificate.findMany({
    where: { userId },
    select: { id: true, publicId: true, type: true, title: true, amount: true, currency: true, metadata: true, issuedAt: true },
    orderBy: { issuedAt: "desc" },
    take: 100,
  });
}

/** Public verification lookup: only what is printed on the certificate - never email, phone or user id. */
export async function getPublicCertificate(publicId: string) {
  if (!CERTIFICATE_PUBLIC_ID_PATTERN.test(publicId)) return null;
  return prisma.certificate.findUnique({
    where: { publicId },
    select: { publicId: true, type: true, title: true, recipientName: true, amount: true, currency: true, metadata: true, issuedAt: true },
  });
}

export type PublicCertificate = NonNullable<Awaited<ReturnType<typeof getPublicCertificate>>>;
