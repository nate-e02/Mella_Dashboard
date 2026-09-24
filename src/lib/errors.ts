/**
 * Typed errors shared by route handlers, services and the trading worker.
 * Kept dependency-free so the worker (which runs outside Next.js) can import
 * services that throw them.
 */
export class AuthError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 401, code?: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

/**
 * A well-formed request that cannot be completed because of the current
 * state of the resource (e.g. refunding a purchase that isn't PAID, deciding
 * a payout that isn't PENDING). Distinct from validation errors (malformed
 * input) and from AuthError (who is allowed to act).
 */
export class ConflictError extends Error {
  status = 409;
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
