import type { Metadata } from "next";
import Link from "next/link";
import { listActiveTemplatesForStorefront } from "@/lib/services/templates";
import { MIN_FUNDED_DAYS_BEFORE_PAYOUT } from "@/lib/services/payouts";
import { formatCurrency } from "@/lib/format";
import { getT } from "@/i18n/server";
import { PublicFooter, PublicHeader } from "@/components/public/PublicChrome";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("app.landing.metaTitle"), description: t("app.landing.metaDescription") };
}

export default async function LandingPage() {
  const [t, templates] = await Promise.all([getT(), listActiveTemplatesForStorefront()]);
  const maxSplit = templates.length > 0 ? Math.max(...templates.map((tpl) => tpl.profitSplit)) : null;

  const features = [
    { title: t("app.landing.feature.pay.title"), body: t("app.landing.feature.pay.body") },
    { title: t("app.landing.feature.payout.title"), body: t("app.landing.feature.payout.body", { days: MIN_FUNDED_DAYS_BEFORE_PAYOUT }) },
    ...(maxSplit ? [{ title: t("app.landing.feature.split.title", { split: maxSplit }), body: t("app.landing.feature.split.body") }] : []),
    { title: t("app.landing.feature.terminal.title"), body: t("app.landing.feature.terminal.body") },
    { title: t("app.landing.feature.rules.title"), body: t("app.landing.feature.rules.body") },
    { title: t("app.landing.feature.local.title"), body: t("app.landing.feature.local.body") },
  ];

  const steps = [
    { title: t("app.landing.step1.title"), body: t("app.landing.step1.body") },
    { title: t("app.landing.step2.title"), body: t("app.landing.step2.body") },
    { title: t("app.landing.step3.title"), body: t("app.landing.step3.body") },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PublicHeader />

      <main className="flex flex-col">
        <section className="mx-auto flex max-w-4xl flex-col items-center gap-5 px-4 py-16 text-center sm:px-6 sm:py-20">
          <span className="rounded-full border border-border bg-surface-2 px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted">
            {t("app.landing.badge")}
          </span>
          <h1 className="text-3xl font-semibold leading-tight sm:text-5xl">{t("app.landing.heroTitle")}</h1>
          <p className="max-w-2xl leading-relaxed text-muted">{t("app.landing.heroBody")}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/register" className="btn-primary">
              {t("app.landing.ctaStart")}
            </Link>
            <Link href="/login" className="btn-secondary">
              {t("app.landing.ctaLogin")}
            </Link>
          </div>
          <Link href="/rules" className="text-sm text-accent-2 hover:underline">
            {t("app.landing.ctaRules")} →
          </Link>
        </section>

        <section className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6" aria-labelledby="features-title">
          <h2 id="features-title" className="mb-6 text-center text-2xl font-semibold">
            {t("app.landing.featuresTitle")}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="card p-5">
                <h3 className="mb-1 text-sm font-semibold">{f.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6" aria-labelledby="steps-title">
          <h2 id="steps-title" className="mb-6 text-center text-2xl font-semibold">
            {t("app.landing.stepsTitle")}
          </h2>
          <ol className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="card flex gap-3 p-5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-2/15 text-sm font-semibold text-accent-2" aria-hidden>
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-sm font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6" aria-labelledby="pricing-title">
          <h2 id="pricing-title" className="text-center text-2xl font-semibold">
            {t("app.landing.pricingTitle")}
          </h2>
          <p className="mb-6 mt-1 text-center text-sm text-muted">{t("app.landing.pricingSubtitle")}</p>
          {templates.length === 0 ? (
            <div className="card p-10 text-center text-sm text-muted">{t("app.landing.noChallenges")}</div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {templates.map((tpl) => (
                <div key={tpl.id} className="card flex flex-col gap-3 p-5">
                  <div className="text-sm text-muted">{tpl.groupName}</div>
                  <div className="text-2xl font-semibold">{formatCurrency(tpl.accountSize, tpl.accountCurrency)}</div>
                  <ul className="flex flex-col gap-1 text-xs text-muted">
                    <li>{tpl.profitTarget ? t("app.landing.card.target", { value: tpl.profitTarget }) : t("app.landing.card.noTarget")}</li>
                    <li>{t("app.landing.card.daily", { value: tpl.dailyDrawdown })}</li>
                    <li>{t(tpl.drawdownMode === "TRAILING" ? "app.landing.card.maxTrailing" : "app.landing.card.maxStatic", { value: tpl.maxDrawdown })}</li>
                    {tpl.minTradingDays > 0 && <li>{t("app.landing.card.minDays", { value: tpl.minTradingDays })}</li>}
                    <li>{t("app.landing.card.split", { value: tpl.profitSplit })}</li>
                  </ul>
                  <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                    <div>
                      <div className="text-[11px] text-muted">{t("app.landing.card.fee")}</div>
                      <div className="text-lg font-semibold">{formatCurrency(tpl.price, tpl.currency)}</div>
                    </div>
                    <Link href="/register" className="btn-secondary !py-1.5 text-xs">
                      {t("app.landing.getStarted")}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
