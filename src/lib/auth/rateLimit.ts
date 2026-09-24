/**
 * Fixed-window rate limiter. Uses Redis (INCR + EXPIRE, atomic) when
 * REDIS_URL is set so limits hold across replicas; falls back to an
 * in-process map for single-instance/local use. Runs in the Node runtime
 * (proxy.ts and route handlers).
 */

type Result = { allowed: boolean; remaining: number; retryAfterSec: number };

type RedisLike = { eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown> };

let redis: RedisLike | null | undefined;
const memory = new Map<string, { count: number; resetAt: number }>();

async function getRedis(): Promise<RedisLike | null> {
  if (redis !== undefined) return redis;
  const url = process.env.REDIS_URL;
  if (!url) {
    redis = null;
    return redis;
  }
  try {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    client.on("error", (err: Error) => console.error("redis error:", err.message));
    await client.connect();
    redis = client as unknown as RedisLike;
  } catch (err) {
    console.error("rate limiter: Redis unavailable, using in-memory limits:", err instanceof Error ? err.message : err);
    redis = null;
  }
  return redis;
}

const LUA = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
local ttl = redis.call("TTL", KEYS[1])
return {current, ttl}
`;

export async function rateLimit(key: string, limit: number, windowSec: number): Promise<Result> {
  const client = await getRedis();
  if (client) {
    try {
      const [count, ttl] = (await client.eval(LUA, 1, `rl:${key}`, windowSec)) as [number, number];
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSec: Math.max(1, ttl) };
    } catch (err) {
      console.error("rate limiter: Redis call failed, falling back to memory:", err instanceof Error ? err.message : err);
    }
  }

  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSec * 1000 });
    if (memory.size > 50_000) {
      for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
    }
    return { allowed: true, remaining: limit - 1, retryAfterSec: windowSec };
  }
  entry.count += 1;
  return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count), retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
}

/**
 * Client IP for rate limiting and audit, read ONLY from the header our own
 * edge sets. Any header a client can send itself (a stray `cf-connecting-ip`
 * without Cloudflare in front, the left-most `X-Forwarded-For` entry) would
 * let an attacker rotate "IPs" and bypass every limit. Next.js passes a
 * client-supplied X-Forwarded-For through unchanged, so production must run
 * behind a proxy that overwrites or appends it.
 *
 *   CLIENT_IP_HEADER=x-forwarded-for (default): the entry TRUSTED_PROXY_HOPS
 *     (default 1) from the right, i.e. the address the nearest trusted proxy
 *     saw (Traefik and Caddy replace untrusted incoming X-Forwarded-For).
 *   CLIENT_IP_HEADER=cf-connecting-ip: behind Cloudflare, with the origin
 *     firewalled to Cloudflare's IP ranges.
 *   CLIENT_IP_HEADER=x-real-ip: behind nginx with `proxy_set_header X-Real-IP $remote_addr`.
 */
export function clientIpFromHeaders(headers: { get(name: string): string | null }, env: Record<string, string | undefined> = process.env): string {
  const header = (env.CLIENT_IP_HEADER || "x-forwarded-for").trim().toLowerCase();
  if (header === "x-forwarded-for") {
    const hops = Math.max(1, Math.floor(Number(env.TRUSTED_PROXY_HOPS)) || 1);
    const chain = (headers.get("x-forwarded-for") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return chain[chain.length - hops] ?? chain[0] ?? "unknown";
  }
  return headers.get(header)?.trim() || "unknown";
}

/** For storage (sessions, audit rows): the "unknown" bucket name becomes null. */
export function nullIfUnknown(ip: string): string | null {
  return ip === "unknown" ? null : ip;
}
