import { z } from "zod";

/**
 * Environment validation. Imported from instrumentation.ts so the server
 * refuses to boot with a missing/placeholder secret or a localhost APP_URL in
 * production, instead of failing on the first request that needs it.
 */

const PLACEHOLDER_SECRETS = new Set(["change_me_to_a_long_random_string", "changeme", "secret", "password"]);

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters")
    .refine((v) => !PLACEHOLDER_SECRETS.has(v.trim().toLowerCase()), "JWT_SECRET is still the placeholder value"),
  SESSION_COOKIE_NAME: z.string().min(1).default("mellafx_session"),
  APP_URL: z.string().url("APP_URL must be an absolute URL"),
  WS_PUBLIC_URL: z.string().optional(),
  NEXT_PUBLIC_WS_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  WORKER_INTERNAL_URL: z.string().url().optional(),
  WORKER_INTERNAL_TOKEN: z.string().optional(),
  CHAPA_SECRET_KEY: z.string().optional(),
  DOJAH_SECRET_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  SMS_GATEWAY_URL: z.string().optional(),
  SMS_API_KEY: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  ENABLE_DEV_OVERRIDES: z.string().optional(),
  ADMIN_MFA_REQUIRED: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid environment configuration:\n  ${problems}`);
  }
  const env = parsed.data;

  if (env.NODE_ENV === "production") {
    const errors: string[] = [];
    if (!env.APP_URL.startsWith("https://")) errors.push("APP_URL must use https in production");
    if (!env.CHAPA_SECRET_KEY) errors.push("CHAPA_SECRET_KEY is required in production");
    if (!env.WORKER_INTERNAL_TOKEN) errors.push("WORKER_INTERNAL_TOKEN is required in production");
    if (env.ENABLE_DEV_OVERRIDES === "true") errors.push("ENABLE_DEV_OVERRIDES must not be enabled in production");
    if (!env.REDIS_URL) errors.push("REDIS_URL is required in production (rate limiting across replicas)");
    if (errors.length > 0) throw new Error(`Refusing to start in production:\n  ${errors.join("\n  ")}`);
  }

  cached = env;
  return env;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** True only outside production when ENABLE_DEV_OVERRIDES=true. */
export function devOverridesEnabled(): boolean {
  return !isProduction() && process.env.ENABLE_DEV_OVERRIDES === "true";
}

export function appUrl(): string {
  const url = process.env.APP_URL;
  if (!url) throw new Error("APP_URL is not configured");
  return url.replace(/\/$/, "");
}

/**
 * Browser-facing WebSocket URL of the trading worker. Read at request time
 * (not a NEXT_PUBLIC_ build-time constant) so one Docker image works in every
 * environment.
 */
export function wsPublicUrl(): string {
  return process.env.WS_PUBLIC_URL || process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4100/ws";
}
