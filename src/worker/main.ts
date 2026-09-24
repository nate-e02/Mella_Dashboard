import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { alertOps } from "@/lib/services/notifications";
import { TradingBus } from "@/trading/bus";
import { CandleBuilder } from "@/trading/candles";
import { CandlePersister, restoreBuilder } from "@/trading/candleStore";
import { Engine } from "@/trading/engine";
import { createProvider } from "@/trading/feeds";
import { planFeeds, subscriptionKey } from "@/trading/feeds/plan";
import { DEFAULT_FAILBACK_STABLE_MS, DEFAULT_FAILOVER_STALE_MS, FeedRouter, type FeedSwitchEvent } from "@/trading/feeds/router";
import type { FeedHealth, MarketDataProvider } from "@/trading/feeds/types";
import { Converter, loadUsdEtbRate } from "@/trading/fx";
import { Gateway } from "@/trading/gateway";
import { createHttpServer } from "@/trading/http";
import { ensureDefaultInstruments } from "@/trading/seedInstruments";
import { startJobs } from "./jobs";
import { createLogger } from "./logger";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`[worker] ${name} is required. Set it in .env (see .env.example) and restart.`);
    process.exit(1);
  }
  return v;
}

export { effectiveFeedSource } from "@/trading/feeds/plan";

export async function main() {
  const databaseUrl = requireEnv("DATABASE_URL");
  const jwtSecret = requireEnv("JWT_SECRET");
  void databaseUrl;

  const log = createLogger();
  const startedAt = Date.now();
  const port = Number(process.env.WORKER_PORT) || 4100;
  const internalToken = process.env.WORKER_INTERNAL_TOKEN || undefined;
  if (!internalToken) log.warn({}, "WORKER_INTERNAL_TOKEN is not set: /status and /internal/* are disabled");

  process.on("unhandledRejection", (err) => log.error({ err: err instanceof Error ? err.stack : err }, "unhandled rejection"));
  process.on("uncaughtException", (err) => log.error({ err: err.stack }, "uncaught exception"));

  if (process.env.SEED_DEFAULT_INSTRUMENTS === "true") {
    const r = await ensureDefaultInstruments();
    log.info(r, "default instruments ensured");
  }

  const bus = new TradingBus(log);
  if (process.env.REDIS_URL) {
    try {
      await bus.connectRedis(process.env.REDIS_URL);
    } catch (err) {
      log.warn({ err: (err as Error).message }, "redis unavailable; continuing without cross-replica publishing");
    }
  }

  const fx = new Converter("ETB");
  const applyFx = async () => {
    const r = await loadUsdEtbRate(prisma);
    fx.setUsdRate(r.rate, r.source);
    if (r.source === "ENV_FALLBACK") log.warn({ rate: r.rate }, "FX: using FX_USD_ETB_FALLBACK for USD->ETB - no FxRate row or fx.usd_etb setting found. P&L will be WRONG until a real rate is loaded.");
    else log.info({ rate: r.rate, source: r.source }, "FX: USD->ETB rate loaded");
  };
  await applyFx();
  const fxTimer = setInterval(() => void applyFx().catch((err) => log.error({ err: (err as Error).message }, "FX refresh failed")), 60_000);

  const engine = new Engine({ bus, fx, log });
  await engine.start();
  if (engine.instruments.size === 0) {
    log.error({}, "No enabled instruments. Run once with SEED_DEFAULT_INSTRUMENTS=true or create Instrument rows, then restart.");
  }

  // Candles
  const builder = new CandleBuilder();
  for (const inst of engine.instruments.values()) builder.setDigits(inst.symbol, inst.digits);
  await restoreBuilder(builder, Array.from(engine.instruments.keys()));
  const persister = new CandlePersister(log);
  persister.start();

  bus.on("tick", (tick) => {
    try {
      engine.onTick(tick);
      const { updated, closed1m } = builder.onTick(tick);
      persister.track(tick.symbol, updated.find((u) => u.tf === "1m")?.bar, closed1m);
      for (const ev of updated) bus.emit("bar", ev);
    } catch (err) {
      log.error({ err: (err as Error).message, symbol: tick.symbol }, "tick processing failed");
    }
  });
  engine.startTimers();

  // Feeds. Every provider tick goes through the router, which forwards only
  // the symbol's active source (primary, or the backup during a failover).
  const router = new FeedRouter({
    staleMs: Number(process.env.FEED_FAILOVER_STALE_MS) || DEFAULT_FAILOVER_STALE_MS,
    stableMs: Number(process.env.FEED_FAILBACK_STABLE_MS) || DEFAULT_FAILBACK_STABLE_MS,
  });
  router.onTick((tick) => bus.emit("tick", tick));
  // One ops alert per burst of switches (a provider outage flips every symbol it serves at once).
  let pendingSwitches: FeedSwitchEvent[] = [];
  let switchAlertTimer: NodeJS.Timeout | null = null;
  router.onSwitch((ev) => {
    log.warn({ ...ev }, ev.reason === "PRIMARY_STALE" ? "feed: FAILOVER to backup source" : "feed: back on primary source");
    pendingSwitches.push(ev);
    switchAlertTimer ??= setTimeout(() => {
      switchAlertTimer = null;
      const batch = pendingSwitches;
      pendingSwitches = [];
      const groups = new Map<string, string[]>();
      for (const e of batch) groups.set(`${e.from} -> ${e.to} (${e.reason})`, [...(groups.get(`${e.from} -> ${e.to} (${e.reason})`) ?? []), e.symbol]);
      void alertOps(`MellaFx feed switch: ${Array.from(groups.entries()).map(([k, syms]) => `${k}: ${syms.join(", ")}`).join("; ")}`);
    }, 1_000);
  });
  const routerTimer = setInterval(() => router.evaluate(), 500);

  // Development only: silence a provider to rehearse a failover (POST /internal/feeds/<source>/pause).
  const pausedSources = new Set<string>();
  const providers = new Map<string, { provider: MarketDataProvider; symbols: string }>();
  const startProviders = async () => {
    const { routes, groups } = planFeeds(engine.instruments.values());
    router.setRoutes(routes);
    for (const [source, symbols] of groups) {
      const key = subscriptionKey(symbols);
      const existing = providers.get(source);
      if (existing && existing.symbols === key) continue;
      if (existing) {
        log.info({ source }, "feed: subscription set changed, restarting provider");
        await existing.provider.stop();
      }
      const provider = createProvider(source, { log, stubSeed: Number(process.env.STUB_SEED) || undefined });
      provider.onTick((tick) => {
        if (pausedSources.size > 0 && pausedSources.has(source)) return;
        router.ingest(source, tick);
      });
      await provider.start(symbols);
      providers.set(source, { provider, symbols: key });
      log.info({ source, symbols: symbols.map((s) => s.symbol) }, "feed: started");
    }
    for (const [source, entry] of providers) {
      if (!groups.has(source)) {
        await entry.provider.stop();
        providers.delete(source);
        log.info({ source }, "feed: stopped (no longer used)");
      }
    }
  };
  await startProviders();
  const syncFeeds = async () => {
    await startProviders();
    for (const inst of engine.instruments.values()) builder.setDigits(inst.symbol, inst.digits);
  };
  const feedSync = setInterval(() => void syncFeeds().catch((err) => log.error({ err: (err as Error).message }, "feed sync failed")), 60_000);

  const feedHealth = (): Record<string, FeedHealth> => Object.fromEntries(Array.from(providers.entries()).map(([s, e]) => [s, e.provider.health()]));

  // Feed staleness alert (once per outage).
  let outageAlerted = false;
  bus.on("market.status", (ms) => {
    if (ms.state === "HALTED" && !engine.isManuallyHalted() && !outageAlerted && Date.now() - startedAt > 30_000) {
      outageAlerted = true;
      void alertOps(`MellaFx worker: market HALTED - ${ms.reason ?? "feed stale"}`);
    } else if (ms.state === "OPEN" && outageAlerted) {
      outageAlerted = false;
      void alertOps("MellaFx worker: market data resumed, trading OPEN");
    }
  });

  // HTTP + gateway
  const server = createHttpServer({
    engine,
    feeds: feedHealth,
    connections: () => gateway.connectionCount(),
    log,
    internalToken,
    startedAt,
    feedRouter: () => ({ staleMs: router.staleMs, stableMs: router.stableMs, symbols: router.state(), switches: router.recentSwitches(), paused: Array.from(pausedSources) }),
    feedControl:
      process.env.NODE_ENV === "production"
        ? undefined
        : {
            setPaused: (source, paused) => {
              const name = source.toUpperCase();
              if (!providers.has(name)) return false;
              if (paused) pausedSources.add(name);
              else pausedSources.delete(name);
              log.warn({ source: name, paused }, "feed: provider ticks paused/resumed (dev failover drill)");
              return true;
            },
          },
    reloadInstruments: async () => {
      await engine.reloadInstruments();
      await syncFeeds();
    },
  });
  const gateway = new Gateway({ server, bus, engine, log, jwtSecret, maxConnections: Number(process.env.WORKER_MAX_CONNECTIONS) || 10_000 });
  gateway.start();
  await new Promise<void>((resolve) => server.listen(port, resolve));
  log.info({ port, ws: `/ws`, instruments: engine.instruments.size, accounts: engine.accounts.size }, "trading worker listening");

  const jobs = startJobs({ engine, log });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.warn({ signal }, "shutting down");
    const forceExit = setTimeout(() => {
      log.error({}, "shutdown timed out, exiting");
      process.exit(1);
    }, 15_000);
    try {
      jobs.stop();
      clearInterval(feedSync);
      clearInterval(routerTimer);
      if (switchAlertTimer) clearTimeout(switchAlertTimer);
      clearInterval(fxTimer);
      for (const e of providers.values()) await e.provider.stop();
      await gateway.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await engine.stop();
      persister.stop();
      await persister.flush();
      await bus.close();
      await prisma.$disconnect();
      clearTimeout(forceExit);
      log.info({}, "bye");
      process.exit(0);
    } catch (err) {
      log.error({ err: (err as Error).message }, "shutdown error");
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
