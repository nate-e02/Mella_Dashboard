import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/services/audit";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown, actorId: string) {
  const before = await prisma.systemSetting.findUnique({ where: { key } });
  const row = await prisma.systemSetting.upsert({
    where: { key },
    update: { value: value as Prisma.InputJsonValue, updatedById: actorId },
    create: { key, value: value as Prisma.InputJsonValue, updatedById: actorId },
  });
  await logAudit({ actorId, action: "SETTING_UPDATED", targetType: "SystemSetting", targetId: key, before: before?.value ?? null, after: row.value });
  return row;
}

/** Latest USD→ETB rate (used to convert USD-quoted instrument P&L into the ETB account currency). */
export async function getUsdEtbRate(): Promise<{ rate: number; source: string; effectiveAt: Date } | null> {
  const row = await prisma.fxRate.findFirst({ where: { base: "USD", quote: "ETB" }, orderBy: { effectiveAt: "desc" } });
  return row ? { rate: row.rate, source: row.source, effectiveAt: row.effectiveAt } : null;
}

export async function setUsdEtbRate(rate: number, source: string, actorId: string) {
  const row = await prisma.fxRate.create({ data: { base: "USD", quote: "ETB", rate, source, effectiveAt: new Date() } });
  await logAudit({ actorId, action: "FX_RATE_SET", targetType: "FxRate", targetId: row.id, after: { base: "USD", quote: "ETB", rate, source } });
  return row;
}

/** Calls the trading worker's internal HTTP API (status, halt/resume, reload). */
export async function workerRequest<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ ok: boolean; status: number; data: T | null }> {
  const base = process.env.WORKER_INTERNAL_URL ?? "http://localhost:4100";
  const token = process.env.WORKER_INTERNAL_TOKEN ?? "";
  try {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? "GET",
      headers: { "x-internal-token": token, "Content-Type": "application/json" },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/** Fire-and-forget: tell the trading worker to (re)load an account so it becomes tradable immediately. */
export function notifyWorkerAccountChanged(accountId: string): void {
  void workerRequest("/internal/reload-account", { method: "POST", body: { accountId } }).catch(() => undefined);
}
