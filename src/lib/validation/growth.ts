import { z } from "zod";

/**
 * Request schemas for the growth features (coupons, referrals, leaderboard).
 * Kept apart from schemas.ts so these features can evolve without touching
 * the shared auth/trading schemas.
 */

const couponCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{3,32}$/, "Codes use 3–32 letters, digits, - or _");

// Admin date inputs arrive as ISO strings (or empty to clear).
const optionalDate = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.date().nullable());

const couponFields = {
  code: couponCode,
  description: z.string().trim().max(300).default(""),
  percentOff: z.number().gt(0).max(100).nullable().default(null),
  amountOff: z.number().gt(0).max(10_000_000).nullable().default(null),
  maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().default(null),
  perUserLimit: z.number().int().min(1).max(100).default(1),
  templateIds: z.array(z.string().min(1).max(100)).max(200).default([]),
  validFrom: optionalDate.default(null),
  validUntil: optionalDate.default(null),
  active: z.boolean().default(true),
};

export const couponCreateSchema = z
  .object(couponFields)
  .refine((v) => (v.percentOff == null) !== (v.amountOff == null), { message: "Set either a percentage or a fixed ETB discount", path: ["percentOff"] });

export const couponUpdateSchema = z.object({
  code: couponCode.optional(),
  description: z.string().trim().max(300).optional(),
  percentOff: z.number().gt(0).max(100).nullable().optional(),
  amountOff: z.number().gt(0).max(10_000_000).nullable().optional(),
  maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
  perUserLimit: z.number().int().min(1).max(100).optional(),
  templateIds: z.array(z.string().min(1).max(100)).max(200).optional(),
  validFrom: optionalDate.optional(),
  validUntil: optionalDate.optional(),
  active: z.boolean().optional(),
});

export const couponValidateSchema = z.object({
  code: z.string().trim().min(1).max(64),
  templateId: z.string().min(1).max(100),
});

export const referralDecisionSchema = z.object({
  action: z.enum(["APPROVE", "PAY", "VOID"]),
  note: z.string().trim().max(500).optional(),
  providerRef: z.string().trim().max(120).optional(),
});

export const referralSettingsSchema = z.object({
  commissionPercent: z.number().min(0).max(50),
});

export const leaderboardProfileSchema = z.object({
  optIn: z.boolean(),
  alias: z.string().max(40).nullable().optional(),
});
