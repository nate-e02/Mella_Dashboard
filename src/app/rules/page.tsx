import type { Metadata } from "next";
import Link from "next/link";
import { listActiveTemplatesForStorefront, type StorefrontTemplate } from "@/lib/services/templates";
import { MIN_FUNDED_DAYS_BEFORE_PAYOUT, MIN_PAYOUT_ETB } from "@/lib/services/payouts";
import { dailyLossFloor, maxDrawdownFloor } from "@/lib/services/challengeRules";
import { formatCurrency } from "@/lib/format";
import { getT, type Translate } from "@/i18n/server";
import { PublicFooter, PublicHeader } from "@/components/public/PublicChrome";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("app.rules.metaTitle"), description: t("app.rules.metaDescription") };
}

/**
 * Worked-example inputs. They mirror the seeded Standard 2-Step (5% daily,
 * 10% static, 8% target, 3 days) and Rapid 1-Step (6% trailing) programs;
 * the floors are computed with the engine's own functions so the examples
 * can never drift from how accounts are actually evaluated.
 */
const SIZE = 500_000;
const ex = (() => {
  const dailyPct = 5;
  const anchor = 510_000;
  const staticPct = 10;
  const trailingPct = 6;
  const trailing = (peak: number) => maxDrawdownFloor({ startingBalance: SIZE, highWaterMark: peak, maxDrawdownPercent: trailingPct, mode: "TRAILING" });
  const targetPct = 8;
  const consistencyPct = 40;
  const totalProfit = 40_000;
  const bestDay = 20_000;
  const split = 80;
  const fundedBalance = 530_000;
  const profit = fundedBalance - SIZE;
  const share = (profit * split) / 100;
  return {
    daily: { pct: dailyPct, anchor, limit: (anchor * dailyPct) / 100, floor: dailyLossFloor({ dailyAnchorBalance: anchor, dailyDrawdownPercent: dailyPct }) },
    static: {
      pct: staticPct,
      limit: (SIZE * staticPct) / 100,
      floor: maxDrawdownFloor({ startingBalance: SIZE, highWaterMark: SIZE, maxDrawdownPercent: staticPct, mode: "STATIC" }),
    },
    trailing: { pct: trailingPct, limit: (SIZE * trailingPct) / 100, floor0: trailing(SIZE), peak1: 515_000, floor1: trailing(515_000), peak2: 530_000 },
    target: { pct: targetPct, days: 3, amount: (SIZE * targetPct) / 100 },
    consistency: { pct: consistencyPct, total: totalProfit, max: (totalProfit * consistencyPct) / 100, best: bestDay, needed: (bestDay * 100) / consistencyPct },
    payout: { split, balance: fundedBalance, profit, share, firm: profit - share },
  };
})();

const etb = (v: number) => formatCurrency(v, "ETB");

type Program = {
  key: string;
  groupName: string;
  sizes: number[];
  currency: string;
  tpl: StorefrontTemplate;
};

/** One row per program whose phase-1 rules are identical across account sizes. */
function groupPrograms(templates: StorefrontTemplate[]): Program[] {
  const map = new Map<string, Program>();
  for (const tpl of templates) {
    const key = [
      tpl.groupName,
      tpl.profitTarget,
      tpl.dailyDrawdown,
      tpl.maxDrawdown,
      tpl.drawdownMode,
      tpl.minTradingDays,
      tpl.durationDays,
      tpl.weekendHoldingAllowed,
      tpl.newsTradingAllowed,
      tpl.profitSplit,
    ].join("|");
    const existing = map.get(key);
    if (existing) existing.sizes.push(tpl.accountSize);
    else map.set(key, { key, groupName: tpl.groupName, sizes: [tpl.accountSize], currency: tpl.accountCurrency, tpl });
  }
  return [...map.values()];
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export default async function RulesPage() {
  const [t, templates] = await Promise.all([getT(), listActiveTemplatesForStorefront()]);
  const programs = groupPrograms(templates);

  const sections = [
    { id: "daily-loss", title: t("app.rules.daily.title") },
    { id: "max-loss", title: t("app.rules.max.title") },
    { id: "target", title: t("app.rules.target.title") },
    { id: "time-limit", title: t("app.rules.time.title") },
    { id: "holding", title: t("app.rules.holding.title") },
    { id: "consistency", title: t("app.rules.consistency.title") },
    { id: "breach", title: t("app.rules.breach.title") },
    { id: "payouts", title: t("app.rules.payouts.title") },
    { id: "programs", title: t("app.rules.programs.title") },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PublicHeader />

      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-3xl font-semibold sm:text-4xl">{t("app.rules.title")}</h1>
        <p className="mt-3 leading-relaxed text-muted">{t("app.rules.intro", { size: etb(SIZE) })}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t("app.public.lastUpdatedNote")}</p>

        <nav aria-labelledby="toc-title" className="card mt-6 p-4">
          <h2 id="toc-title" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {t("app.rules.toc")}
          </h2>
          <ol className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-accent-2 hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <Section id="terms" title={t("app.rules.terms.title")}>
          <dl className="flex flex-col gap-3">
            {(["balance", "equity", "day"] as const).map((k) => (
              <div key={k}>
                <dt className="font-medium">{t(`app.rules.terms.${k}.term`)}</dt>
                <dd className="text-muted">{t(`app.rules.terms.${k}.def`)}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section id="daily-loss" title={t("app.rules.daily.title")}>
          <p>{t("app.rules.daily.body")}</p>
          <Example t={t}>
            {t("app.rules.daily.example", {
              size: etb(SIZE),
              pct: ex.daily.pct,
              anchor: etb(ex.daily.anchor),
              limit: etb(ex.daily.limit),
              floor: etb(ex.daily.floor),
            })}
          </Example>
        </Section>

        <Section id="max-loss" title={t("app.rules.max.title")}>
          <p>{t("app.rules.max.body")}</p>
          <h3 className="mt-2 font-semibold text-foreground">{t("app.rules.max.static.title")}</h3>
          <p>{t("app.rules.max.static.body")}</p>
          <Example t={t}>
            {t("app.rules.max.static.example", { size: etb(SIZE), pct: ex.static.pct, limit: etb(ex.static.limit), floor: etb(ex.static.floor) })}
          </Example>
          <h3 className="mt-2 font-semibold text-foreground">{t("app.rules.max.trailing.title")}</h3>
          <p>{t("app.rules.max.trailing.body")}</p>
          <Example t={t}>
            {t("app.rules.max.trailing.example", {
              size: etb(SIZE),
              pct: ex.trailing.pct,
              limit: etb(ex.trailing.limit),
              floor0: etb(ex.trailing.floor0),
              peak1: etb(ex.trailing.peak1),
              floor1: etb(ex.trailing.floor1),
              peak2: etb(ex.trailing.peak2),
            })}
          </Example>
        </Section>

        <Section id="target" title={t("app.rules.target.title")}>
          <p>{t("app.rules.target.body")}</p>
          <Example t={t}>
            {t("app.rules.target.example", { size: etb(SIZE), pct: ex.target.pct, days: ex.target.days, amount: etb(ex.target.amount) })}
          </Example>
          <p>{t("app.rules.target.phases")}</p>
        </Section>

        <Section id="time-limit" title={t("app.rules.time.title")}>
          <p>{t("app.rules.time.body")}</p>
        </Section>

        <Section id="holding" title={t("app.rules.holding.title")}>
          <p>{t("app.rules.holding.body")}</p>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>{t("app.rules.holding.weekend")}</li>
            <li>{t("app.rules.holding.overnight")}</li>
            <li>{t("app.rules.holding.news")}</li>
          </ul>
        </Section>

        <Section id="consistency" title={t("app.rules.consistency.title")}>
          <p>{t("app.rules.consistency.body")}</p>
          <Example t={t}>
            {t("app.rules.consistency.example", {
              pct: ex.consistency.pct,
              total: etb(ex.consistency.total),
              max: etb(ex.consistency.max),
              best: etb(ex.consistency.best),
              needed: etb(ex.consistency.needed),
            })}
          </Example>
        </Section>

        <Section id="breach" title={t("app.rules.breach.title")}>
          <p>{t("app.rules.breach.body")}</p>
        </Section>

        <Section id="payouts" title={t("app.rules.payouts.title")}>
          <p>{t("app.rules.payouts.body")}</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>{t("app.rules.payouts.funded", { days: MIN_FUNDED_DAYS_BEFORE_PAYOUT })}</li>
            <li>{t("app.rules.payouts.kyc")}</li>
            <li>{t("app.rules.payouts.min", { min: etb(MIN_PAYOUT_ETB) })}</li>
          </ul>
          <p>{t("app.rules.payouts.available")}</p>
          <p>{t("app.rules.payouts.review")}</p>
          <Example t={t}>
            {t("app.rules.payouts.example", {
              size: etb(SIZE),
              split: ex.payout.split,
              balance: etb(ex.payout.balance),
              profit: etb(ex.payout.profit),
              share: etb(ex.payout.share),
              firm: etb(ex.payout.firm),
            })}
          </Example>
        </Section>

        <Section id="programs" title={t("app.rules.programs.title")}>
          <p>{t("app.rules.programs.subtitle")}</p>
          {programs.length === 0 ? (
            <div className="card p-6 text-center text-muted">{t("app.rules.programs.empty")}</div>
          ) : (
            <div className="flex flex-col gap-3">
              {programs.map((p) => (
                <ProgramCard key={p.key} program={p} t={t} />
              ))}
            </div>
          )}
        </Section>

        <div className="card mt-12 flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">{t("app.public.ctaTitle")}</h2>
            <p className="text-sm text-muted">{t("app.public.ctaBody")}</p>
          </div>
          <div className="flex gap-2">
            <Link href="/register" className="btn-primary">
              {t("app.landing.ctaStart")}
            </Link>
            <Link href="/faq" className="btn-secondary">
              {t("common.nav.faq")}
            </Link>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-10 scroll-mt-6">
      <h2 id={`${id}-title`} className="mb-3 text-xl font-semibold">
        {title}
      </h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-muted sm:text-base">{children}</div>
    </section>
  );
}

function Example({ t, children }: { t: Translate; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-accent-2/30 bg-accent-2/5 p-4 text-sm leading-relaxed text-foreground">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent-2">{t("app.rules.example")}</div>
      <p>{children}</p>
    </div>
  );
}

function ProgramCard({ program, t }: { program: Program; t: Translate }) {
  const { tpl } = program;
  const sizes = `${program.sizes.map((s) => compact.format(s)).join(" / ")} ${program.currency}`;
  const rows: [string, string][] = [
    [t("app.rules.programs.sizes"), sizes],
    [t("app.rules.programs.target"), tpl.profitTarget ? `${tpl.profitTarget}%` : t("app.rules.programs.noLimit")],
    [t("app.rules.programs.daily"), `${tpl.dailyDrawdown}%`],
    [
      t("app.rules.programs.max"),
      `${tpl.maxDrawdown}% (${tpl.drawdownMode === "TRAILING" ? t("app.rules.programs.trailing") : t("app.rules.programs.static")})`,
    ],
    [t("app.rules.programs.minDays"), String(tpl.minTradingDays)],
    [t("app.rules.programs.time"), tpl.durationDays ? t("app.rules.programs.days", { n: tpl.durationDays }) : t("app.rules.programs.noLimit")],
    [t("app.rules.programs.weekend"), tpl.weekendHoldingAllowed ? t("app.rules.programs.allowed") : t("app.rules.programs.notAllowed")],
    [t("app.rules.programs.news"), tpl.newsTradingAllowed ? t("app.rules.programs.allowed") : t("app.rules.programs.notAllowed")],
    [t("app.rules.programs.split"), `${tpl.profitSplit}%`],
  ];
  return (
    <div className="card p-4">
      <h3 className="mb-3 font-semibold text-foreground">{program.groupName}</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 border-b border-border/50 pb-1.5">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
