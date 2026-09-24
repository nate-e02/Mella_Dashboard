import type { PrismaClient } from "@prisma/client";
import { roundCurrency } from "@/lib/services/calculations";

/**
 * Quote-currency -> account-currency (ETB) conversion for P&L and margin.
 *
 * USD -> ETB comes from the latest FxRate row (base USD, quote ETB), else the
 * SystemSetting `fx.usd_etb` ({ rate }), else the FX_USD_ETB_FALLBACK env
 * (default 125, with a loud warning). USDT/USDC are treated as USD. Any other
 * quote currency is routed through USD using the live mid of `<QUOTE>USD` or
 * `USD<QUOTE>` from the feed (e.g. JPY via USDJPY: usd = jpy / mid). With no
 * path the instrument is not tradable (orders are rejected with NO_FX_PATH).
 */

export const DEFAULT_USD_ETB_FALLBACK = 125;
export const USD_EQUIVALENTS = new Set(["USD", "USDT", "USDC"]);

export class NoFxPathError extends Error {
  code = "NO_FX_PATH" as const;
  constructor(quote: string) {
    super(`No FX conversion path for ${quote}`);
  }
}

export type FxRateSource = "FX_RATE_TABLE" | "SYSTEM_SETTING" | "ENV_FALLBACK" | "MANUAL";

export class Converter {
  private usdToAccount: number | null = null;
  private usdSource: FxRateSource | null = null;
  private mids = new Map<string, number>();

  constructor(public readonly accountCurrency: string = "ETB") {}

  setUsdRate(rate: number, source: FxRateSource) {
    if (!Number.isFinite(rate) || rate <= 0) return;
    this.usdToAccount = rate;
    this.usdSource = source;
  }

  usdRate(): { rate: number; source: FxRateSource } | null {
    return this.usdToAccount ? { rate: this.usdToAccount, source: this.usdSource! } : null;
  }

  /** Feed the latest mid of every instrument; only USD crosses are used. */
  updateMid(symbol: string, mid: number) {
    if (Number.isFinite(mid) && mid > 0) this.mids.set(symbol, mid);
  }

  mid(symbol: string): number | undefined {
    return this.mids.get(symbol);
  }

  /** USD per 1 unit of `quote`, or null when no path is known. */
  quoteToUsd(quote: string): number | null {
    const q = quote.toUpperCase();
    if (USD_EQUIVALENTS.has(q)) return 1;
    const direct = this.mids.get(`${q}USD`);
    if (direct) return direct;
    const inverse = this.mids.get(`USD${q}`);
    if (inverse) return 1 / inverse;
    return null;
  }

  /** Account-currency units per 1 unit of `quote`, or null when no path is known. */
  rate(quote: string): number | null {
    const q = quote.toUpperCase();
    if (q === this.accountCurrency) return 1;
    if (!this.usdToAccount) return null;
    const toUsd = this.quoteToUsd(q);
    return toUsd == null ? null : toUsd * this.usdToAccount;
  }

  toAccountCurrency(amountInQuote: number, quoteCurrency: string): { amount: number; rate: number } {
    const rate = this.rate(quoteCurrency);
    if (rate == null) throw new NoFxPathError(quoteCurrency);
    return { amount: roundCurrency(amountInQuote * rate), rate };
  }
}

type FxDb = Pick<PrismaClient, "fxRate" | "systemSetting">;

/** Resolves the USD->ETB rate from the DB, then settings, then env (see module doc). */
export async function loadUsdEtbRate(db: FxDb, env: NodeJS.ProcessEnv = process.env): Promise<{ rate: number; source: FxRateSource }> {
  const row = await db.fxRate.findFirst({ where: { base: "USD", quote: "ETB", effectiveAt: { lte: new Date() } }, orderBy: { effectiveAt: "desc" }, select: { rate: true } });
  if (row && row.rate > 0) return { rate: row.rate, source: "FX_RATE_TABLE" };
  const setting = await db.systemSetting.findUnique({ where: { key: "fx.usd_etb" }, select: { value: true } });
  const settingRate = Number((setting?.value as { rate?: unknown } | null)?.rate);
  if (Number.isFinite(settingRate) && settingRate > 0) return { rate: settingRate, source: "SYSTEM_SETTING" };
  const fallback = Number(env.FX_USD_ETB_FALLBACK);
  return { rate: Number.isFinite(fallback) && fallback > 0 ? fallback : DEFAULT_USD_ETB_FALLBACK, source: "ENV_FALLBACK" };
}
