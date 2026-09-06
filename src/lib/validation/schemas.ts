import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export const createUserSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  role: z.enum(["ADMIN", "TRADER"]).default("TRADER"),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(["ADMIN", "TRADER"]).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

export const templateSchema = z.object({
  name: z.string().min(2, "Name is required").max(150),
  description: z.string().max(2000).default(""),
  price: z.number().min(0),
  currency: z.string().min(1).max(10).default("USD"),
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]).default("DRAFT"),
  phase: z.enum(["PHASE_1", "PHASE_2", "FUNDED"]),
  programType: z.enum([
    "STANDARD",
    "SWING_TRADER",
    "AGGRESSIVE",
    "INSTANT_FUNDING",
    "CONSISTENCY",
    "ELITE",
    "CRYPTO",
  ]),
  groupName: z.string().min(1).max(100),
  groupKey: z.string().min(1).max(100),

  startingBalance: z.number().positive(),
  accountSize: z.number().positive(),
  leverage: z.number().int().positive(),
  accountCurrency: z.string().min(1).max(10).default("USD"),

  profitTarget: z.number().min(0).nullable().optional(),
  profitSplit: z.number().int().min(0).max(100).default(80),
  maxDrawdown: z.number().min(0),
  dailyDrawdown: z.number().min(0),
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
  dailyLossResetTime: z.string().max(50).default("00:00 UTC"),
  consistencyRequirement: z.number().min(0).max(100).nullable().optional(),

  nextPhaseId: z.string().nullable().optional(),
});

export const templateUpdateSchema = templateSchema.partial();

export const kycDecisionSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  notes: z.string().max(2000).optional(),
});

export const kycCreateSchema = z.object({
  userId: z.string().min(1),
  fullName: z.string().min(2).max(150),
  country: z.string().min(2).max(100),
  documentType: z.string().min(2).max(100),
});

export const leadSchema = z.object({
  name: z.string().min(2).max(150),
  email: z.string().email(),
  phone: z.string().max(50).optional(),
  status: z.enum(["NEW", "QUALIFIED", "NEGOTIATION", "CONVERTED", "LOST"]).default("NEW"),
  source: z.string().max(100).default("Website"),
  value: z.number().min(0).default(0),
  notes: z.string().max(2000).default(""),
});

export const demoPurchaseSchema = z.object({
  templateId: z.string().min(1),
  amount: z.number().positive().max(1_000_000, "Demo amount is unreasonably large"),
  // One key per purchase attempt (client-generated), used to make retried
  // submissions of the same attempt idempotent. Optional for backward
  // compatibility with any other caller of this schema.
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export const accountStatusSchema = z.object({
  status: z.enum(["ACTIVE", "PASSED", "FAILED", "SUSPENDED", "FROZEN", "FUNDED"]),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().optional().default(""),
});
