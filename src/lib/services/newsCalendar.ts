import "server-only";
import type { NewsImpact, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/services/audit";
import { ConflictError } from "@/lib/errors";
import { getSetting, setSetting, workerRequest } from "@/lib/services/settings";
import { DEFAULT_NEWS_WINDOW_MINUTES, NEWS_WINDOW_SETTING, normalizeNewsWindowMinutes } from "@/trading/news";

/**
 * Economic calendar for the news-trading rule: admin CRUD, CSV bulk import
 * and the optional scheduled import of a Forex-Factory-style weekly JSON feed
 * (NEWS_CALENDAR_URL). Imports upsert by a deterministic `externalId`, so
 * re-importing the same file or feed never duplicates events. The trading
 * worker reloads HIGH-impact events every 60 s; every change here also pokes
 * it so the window applies at once.
 */

const IMPACTS: readonly NewsImpact[] = ["LOW", "MEDIUM", "HIGH"];
/** ISO-8601 with an explicit offset: an event time without a zone is ambiguous. */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})$/;

export type EventInput = { title: string; currency: string; impact: NewsImpact; scheduledAt: Date; externalId?: string | null; source?: string };

// ---------------------------------------------------------------------------
// Pure parsing (unit-tested)
// ---------------------------------------------------------------------------

export function parseImpact(value: unknown): NewsImpact | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  if (v === "MED") return "MEDIUM";
  return (IMPACTS as readonly string[]).includes(v) ? (v as NewsImpact) : null;
}

export function parseEventTime(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_WITH_OFFSET.test(value.trim())) return null;
  // Reject impossible calendar dates (2026-02-30) instead of letting Date roll them over.
  const [y, m, day] = value.trim().slice(0, 10).split("-").map(Number);
  if (m < 1 || m > 12 || day < 1 || new Date(Date.UTC(y, m - 1, day)).getUTCDate() !== day) return null;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const c = value.trim().toUpperCase();
  // Forex Factory uses "All" for global events; they map to no single currency.
  return /^[A-Z]{3}$/.test(c) && c !== "ALL" ? c : null;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Identity of an imported event: currency + UTC day + title. A release
 * rescheduled within the same day updates the existing row instead of adding
 * a second one.
 */
export function eventExternalId(prefix: string, e: { currency: string; title: string; scheduledAt: Date }): string {
  return `${prefix}:${e.currency}:${e.scheduledAt.toISOString().slice(0, 10)}:${slug(e.title)}`;
}

/** Splits one CSV line, honouring double quotes ("" escapes a quote). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === "") {
      quoted = true; // quotes are only special at the start of a field
      cur = "";
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * CSV with columns `title,currency,impact,datetime` (a header row is
 * optional); datetime is ISO-8601 with an offset, e.g. 2026-09-25T08:30:00-04:00.
 * Returns the valid rows and a message per rejected line (1-based).
 */
export function parseEventsCsv(text: string): { rows: EventInput[]; errors: { line: number; message: string }[] } {
  const rows: EventInput[] = [];
  const errors: { line: number; message: string }[] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim() || raw.trim().startsWith("#")) return;
    const cols = splitCsvLine(raw);
    if (index === 0 && cols[0]?.toLowerCase() === "title") return;
    if (cols.length < 4) return errors.push({ line, message: "expected 4 columns: title,currency,impact,datetime" });
    const [title, currencyRaw, impactRaw, when] = cols;
    const currency = normalizeCurrency(currencyRaw);
    const impact = parseImpact(impactRaw);
    const scheduledAt = parseEventTime(when);
    if (!title || title.length > 200) return errors.push({ line, message: "title is required (max 200 characters)" });
    if (!currency) return errors.push({ line, message: `invalid currency "${currencyRaw}" (3-letter ISO code)` });
    if (!impact) return errors.push({ line, message: `invalid impact "${impactRaw}" (LOW, MEDIUM or HIGH)` });
    if (!scheduledAt) return errors.push({ line, message: `invalid datetime "${when}" (ISO-8601 with offset, e.g. 2026-09-25T08:30:00-04:00)` });
    rows.push({ title, currency, impact, scheduledAt, externalId: eventExternalId("csv", { currency, title, scheduledAt }), source: "CSV" });
  });
  return { rows, errors };
}

/**
 * Forex-Factory-style weekly JSON:
 * `[{ "title": "Non-Farm Employment Change", "country": "USD", "date": "2026-09-25T08:30:00-04:00", "impact": "High" }]`.
 * Holidays / non-economic entries and anything malformed are skipped.
 */
export function parseForexFactoryCalendar(json: unknown): EventInput[] {
  if (!Array.isArray(json)) return [];
  const out: EventInput[] = [];
  for (const item of json) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title.trim().slice(0, 200) : "";
    const currency = normalizeCurrency(r.country);
    const impact = parseImpact(r.impact);
    const scheduledAt = parseEventTime(r.date);
    if (!title || !currency || !impact || !scheduledAt) continue;
    out.push({ title, currency, impact, scheduledAt, externalId: eventExternalId("ff", { currency, title, scheduledAt }), source: "FOREX_FACTORY" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

function pokeWorker() {
  void workerRequest("/internal/reload-news", { method: "POST" }).catch(() => undefined);
}

export async function listEconomicEvents(params: { scope: "upcoming" | "past"; page: number; pageSize: number; now?: Date }) {
  const now = params.now ?? new Date();
  // "Upcoming" keeps events whose window may still be open (last 2 h).
  const boundary = new Date(now.getTime() - 2 * 3_600_000);
  const where: Prisma.EconomicEventWhereInput = params.scope === "upcoming" ? { scheduledAt: { gte: boundary } } : { scheduledAt: { lt: boundary } };
  const [items, total] = await Promise.all([
    prisma.economicEvent.findMany({
      where,
      orderBy: { scheduledAt: params.scope === "upcoming" ? "asc" : "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.economicEvent.count({ where }),
  ]);
  return { items, total, page: params.page, pageSize: params.pageSize, totalPages: Math.max(1, Math.ceil(total / params.pageSize)) };
}

export async function createEconomicEvent(input: { title: string; currency: string; impact: NewsImpact; scheduledAt: Date }, actorId: string) {
  const currency = normalizeCurrency(input.currency);
  if (!currency) throw new ConflictError("Currency must be a 3-letter ISO code");
  const row = await prisma.economicEvent.create({
    data: { title: input.title.trim().slice(0, 200), currency, impact: input.impact, scheduledAt: input.scheduledAt, source: "MANUAL" },
  });
  await logAudit({ actorId, action: "NEWS_EVENT_CREATED", targetType: "EconomicEvent", targetId: row.id, after: { title: row.title, currency, impact: row.impact, scheduledAt: row.scheduledAt.toISOString() } });
  pokeWorker();
  return row;
}

export async function deleteEconomicEvent(id: string, actorId: string) {
  const before = await prisma.economicEvent.findUniqueOrThrow({ where: { id } });
  await prisma.economicEvent.delete({ where: { id } });
  await logAudit({ actorId, action: "NEWS_EVENT_DELETED", targetType: "EconomicEvent", targetId: id, before: { title: before.title, currency: before.currency, impact: before.impact, scheduledAt: before.scheduledAt.toISOString(), source: before.source } });
  pokeWorker();
}

/** Upserts events by externalId (rows without one are inserted). Returns created/updated counts. */
export async function upsertEconomicEvents(rows: EventInput[]): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const data = { title: r.title, currency: r.currency, impact: r.impact, scheduledAt: r.scheduledAt, source: r.source ?? "IMPORT" };
    if (!r.externalId) {
      await prisma.economicEvent.create({ data });
      created += 1;
      continue;
    }
    const existing = await prisma.economicEvent.findUnique({ where: { externalId: r.externalId }, select: { id: true } });
    await prisma.economicEvent.upsert({ where: { externalId: r.externalId }, create: { ...data, externalId: r.externalId }, update: data });
    if (existing) updated += 1;
    else created += 1;
  }
  return { created, updated };
}

export async function importEventsCsv(csv: string, actorId: string) {
  const { rows, errors } = parseEventsCsv(csv);
  if (rows.length === 0) throw new ConflictError(errors.length ? `No valid rows. First error on line ${errors[0].line}: ${errors[0].message}` : "The CSV contains no rows");
  const result = await upsertEconomicEvents(rows);
  await logAudit({ actorId, action: "NEWS_EVENTS_IMPORTED", targetType: "EconomicEvent", targetId: null, after: { ...result, rejected: errors.length, source: "CSV" } });
  pokeWorker();
  return { ...result, errors };
}

/** Scheduled import from NEWS_CALENDAR_URL (worker job). */
export async function importCalendarFromUrl(url: string, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`calendar fetch failed: HTTP ${res.status}`);
  const rows = parseForexFactoryCalendar(await res.json());
  const result = await upsertEconomicEvents(rows);
  await logAudit({ actorId: null, action: "NEWS_EVENTS_IMPORTED", targetType: "EconomicEvent", targetId: null, after: { ...result, source: "NEWS_CALENDAR_URL", host: new URL(url).host }, context: null });
  return { fetched: rows.length, ...result };
}

export async function getNewsWindowMinutes(): Promise<number> {
  return normalizeNewsWindowMinutes(await getSetting<unknown>(NEWS_WINDOW_SETTING, DEFAULT_NEWS_WINDOW_MINUTES));
}

export async function setNewsWindowMinutes(minutes: number, actorId: string) {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 120) throw new ConflictError("The news window must be between 0 and 120 minutes");
  await setSetting(NEWS_WINDOW_SETTING, minutes, actorId);
  pokeWorker();
  return minutes;
}
