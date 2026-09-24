import { z } from "zod";

const COMMON_PASSWORDS = new Set(["password", "password1", "123456789012", "qwertyuiop12", "admin1234567", "mellafx12345"]);

/**
 * Password policy: 12–72 characters (bcrypt truncates at 72 bytes), must not
 * be a well-known password. Complexity classes are not enforced; length is
 * what matters, and the login endpoint is rate-limited and lock-out protected.
 */
export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(72, "Password must be at most 72 characters")
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), "This password is too common");

const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  email: emailSchema,
  password: passwordSchema,
  phone: z.string().trim().regex(/^\+?[0-9]{9,15}$/, "Enter a valid phone number").optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(72),
});

export const mfaCodeSchema = z.object({
  code: z.string().trim().min(6).max(12),
});

export const mfaDisableSchema = z.object({
  password: z.string().min(1).max(72),
  code: z.string().trim().min(6).max(12),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(128),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({ token: z.string().min(16).max(128) });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(72),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, { message: "New password must be different", path: ["newPassword"] });

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(["ADMIN", "TRADER"]).default("TRADER"),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  email: emailSchema.optional(),
  role: z.enum(["ADMIN", "TRADER"]).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

export const templateSchema = z.object({
  name: z.string().min(2, "Name is required").max(150),
  description: z.string().max(2000).default(""),
  price: z.number().min(0),
  currency: z.literal("ETB").default("ETB"),
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]).default("DRAFT"),
  phase: z.enum(["PHASE_1", "PHASE_2", "FUNDED"]),
  programType: z.enum(["STANDARD", "SWING_TRADER", "AGGRESSIVE", "INSTANT_FUNDING", "CONSISTENCY", "ELITE", "CRYPTO"]),
  groupName: z.string().min(1).max(100),
  groupKey: z.string().min(1).max(100),

  startingBalance: z.number().positive(),
  accountSize: z.number().positive(),
  leverage: z.number().int().positive().max(500),
  accountCurrency: z.literal("ETB").default("ETB"),

  profitTarget: z.number().min(0).max(100).nullable().optional(),
  profitSplit: z.number().int().min(0).max(100).default(80),
  maxDrawdown: z.number().positive("Max drawdown must be greater than 0").max(100),
  drawdownMode: z.enum(["STATIC", "TRAILING"]).default("STATIC"),
  dailyDrawdown: z.number().positive("Daily drawdown must be greater than 0").max(100),
  minTradingDays: z.number().int().min(0).default(0),
  maxTradingDays: z.number().int().min(0).nullable().optional(),
  maxPositionSize: z.number().min(0).nullable().optional(),
  maxPositions: z.number().int().min(0).nullable().optional(),
  durationDays: z.number().int().min(0).nullable().optional(),
  passingRequirements: z.string().max(2000).default(""),
  failingRequirements: z.string().max(2000).default(""),

  weekendHoldingAllowed: z.boolean().default(true),
  overnightHoldingAllowed: z.boolean().default(true),
  newsTradingAllowed: z.boolean().default(true),
  stopLossRequired: z.boolean().default(false),
  dailyLossResetTime: z
    .string()
    .max(50)
    .regex(/^\d{1,2}:\d{2}\s*([A-Za-z]+|[+-]\d{2}:?\d{2})$/, 'Use the form "HH:MM EAT" or "HH:MM +03:00"')
    .default("00:00 EAT"),
  consistencyRequirement: z.number().min(0).max(100).nullable().optional(),

  nextPhaseId: z.string().nullable().optional(),
});

export const templateUpdateSchema = templateSchema.partial();

export const kycDecisionSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  notes: z.string().max(2000).optional(),
});

// Development-only KYC override (route is 404 unless ENABLE_DEV_OVERRIDES=true outside production).
export const kycOverrideSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  reason: z.string().max(500).optional(),
});

export const leadSchema = z.object({
  name: z.string().min(2).max(150),
  email: emailSchema,
  phone: z.string().max(50).optional(),
  status: z.enum(["NEW", "QUALIFIED", "NEGOTIATION", "CONVERTED", "LOST"]).default("NEW"),
  source: z.string().max(100).default("Website"),
  value: z.number().min(0).default(0),
  notes: z.string().max(2000).default(""),
});

// Deliberately has NO `amount` field: the price is always resolved
// server-side from the template in the database.
export const initiatePurchaseSchema = z.object({
  templateId: z.string().min(1),
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export const accountStatusSchema = z.object({
  status: z.enum(["ACTIVE", "PASSED", "FAILED", "SUSPENDED", "FROZEN", "FUNDED"]),
  reason: z.string().max(500).optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().max(100).optional().default(""),
});

/** Parses an optional query-string enum filter, falling back to "ALL" for anything unexpected. */
export function enumParam<const T extends readonly [string, ...string[]]>(values: T, raw: string | null): T[number] | "ALL" {
  return z.enum(["ALL", ...values]).catch("ALL").parse(raw ?? "ALL") as T[number] | "ALL";
}

export const payoutDestinationSchema = z.object({
  type: z.enum(["TELEBIRR", "CBE_BIRR", "BANK"]),
  accountNumber: z.string().trim().min(6).max(40),
  accountName: z.string().trim().min(2).max(120),
  bankCode: z.string().trim().max(40).optional(),
});

export const traderPayoutRequestSchema = z.object({
  tradingAccountId: z.string().min(1),
  amount: z.number().positive().max(1_000_000_000),
  destination: payoutDestinationSchema,
});

export const adminCreatePayoutSchema = z.object({
  tradingAccountId: z.string().min(1),
  amount: z.number().positive().max(1_000_000_000),
  destination: payoutDestinationSchema.optional(),
  note: z.string().max(500).optional(),
});

export const payoutDecisionSchema = z.object({
  status: z.enum(["APPROVED", "PAID", "REJECTED"]),
  reason: z.string().max(500).optional(),
  providerRef: z.string().max(120).optional(),
});

export const fxRateSchema = z.object({
  rate: z.number().positive().max(100000),
  source: z.string().max(50).default("MANUAL"),
});

export const supportTicketSchema = z.object({
  subject: z.string().trim().min(3).max(150),
  message: z.string().trim().min(5).max(4000),
});

export const supportTicketUpdateSchema = z.object({
  status: z.enum(["OPEN", "PENDING", "RESOLVED", "CLOSED"]).optional(),
  response: z.string().max(4000).optional(),
  priority: z.enum(["low", "normal", "high"]).optional(),
});
