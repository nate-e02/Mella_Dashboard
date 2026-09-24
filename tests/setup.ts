// Vitest global setup: sane env defaults for integration tests. Real values
// from .env (loaded by vitest.config.ts) take precedence when present.
(process.env as Record<string, string>).NODE_ENV = process.env.NODE_ENV || "test";
process.env.APP_URL = process.env.APP_URL || "http://localhost:3000";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret-that-is-at-least-32-characters-long";
process.env.ENABLE_DEV_OVERRIDES = "true";
process.env.ADMIN_MFA_REQUIRED = "false";
