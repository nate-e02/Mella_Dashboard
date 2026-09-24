import http from "node:http";
import { prisma } from "@/lib/prisma";
import type { Engine, EngineLogger } from "./engine";
import type { FeedHealth } from "./feeds/types";
import { FEED_STALE_MS } from "@/trading/protocol";

/**
 * Internal HTTP server: health for the load balancer, status/kill switch
 * for the admin UI (guarded by x-internal-token).
 */

export type HttpDeps = {
  engine: Engine;
  feeds: () => Record<string, FeedHealth>;
  connections: () => number;
  log: EngineLogger;
  internalToken?: string;
  startedAt: number;
};

async function dbReachable(timeoutMs = 3_000): Promise<boolean> {
  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, new Promise((_, reject) => setTimeout(() => reject(new Error("db timeout")), timeoutMs))]);
    return true;
  } catch {
    return false;
  }
}

function readJson(req: http.IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > limit) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body) as Record<string, unknown>);
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store" });
  res.end(text);
}

export function createHttpServer(deps: HttpDeps): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/health") {
        const ok = await dbReachable();
        const feeds = deps.feeds();
        json(res, ok ? 200 : 503, {
          ok,
          feeds: Object.fromEntries(Object.entries(feeds).map(([name, h]) => [name, { connected: h.connected, lastTickAt: h.lastTickAt }])),
          marketState: deps.engine.marketStatus().state,
          uptime: Math.round((Date.now() - deps.startedAt) / 1000),
        });
        return;
      }

      const authorized = Boolean(deps.internalToken) && req.headers["x-internal-token"] === deps.internalToken;
      if (url.pathname === "/status" || url.pathname.startsWith("/internal/")) {
        if (!authorized) {
          json(res, deps.internalToken ? 401 : 503, { error: deps.internalToken ? "unauthorized" : "WORKER_INTERNAL_TOKEN is not configured" });
          return;
        }
      }

      if (req.method === "GET" && url.pathname === "/status") {
        const now = Date.now();
        const feeds = deps.feeds();
        const symbols: Record<string, { source: string; lastTickAt: number | null; stale: boolean }> = {};
        for (const [source, h] of Object.entries(feeds)) {
          for (const [symbol, s] of Object.entries(h.symbols)) {
            symbols[symbol] = { source, lastTickAt: s.lastTickAt, stale: s.lastTickAt == null || now - s.lastTickAt > FEED_STALE_MS };
          }
        }
        json(res, 200, {
          feeds: Object.fromEntries(Object.entries(feeds).map(([name, h]) => [name, { connected: h.connected, lastTickAt: h.lastTickAt }])),
          symbols,
          connections: deps.connections(),
          engine: deps.engine.status(),
          uptime: Math.round((now - deps.startedAt) / 1000),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/internal/reload-account") {
        const body = await readJson(req);
        const accountId = typeof body.accountId === "string" ? body.accountId : "";
        if (!accountId) {
          json(res, 400, { error: "accountId is required" });
          return;
        }
        const acct = await deps.engine.reloadAccount(accountId);
        json(res, 200, { accountId, tracked: Boolean(acct), status: acct?.status ?? null });
        return;
      }

      if (req.method === "POST" && (url.pathname === "/internal/halt" || url.pathname === "/internal/resume")) {
        const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
        const halt = url.pathname === "/internal/halt";
        const reason = typeof body.reason === "string" ? body.reason.slice(0, 200) : undefined;
        await deps.engine.setManualHalt(halt, reason);
        deps.log.warn({ halt, reason }, "http: manual kill switch changed");
        json(res, 200, { halted: halt, marketState: deps.engine.marketStatus() });
        return;
      }

      json(res, 404, { error: "not found" });
    } catch (err) {
      deps.log.error({ err: (err as Error).message, path: url.pathname }, "http: request failed");
      json(res, 500, { error: "internal error" });
    }
  });
  server.keepAliveTimeout = 65_000;
  return server;
}
