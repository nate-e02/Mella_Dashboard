import type { Metadata } from "next";
import Link from "next/link";
import { listActiveTemplatesForStorefront } from "@/lib/services/templates";
import { MIN_FUNDED_DAYS_BEFORE_PAYOUT, MIN_PAYOUT_ETB } from "@/lib/services/payouts";
import { formatCurrency } from "@/lib/format";
import { getT } from "@/i18n/server";
import { PublicFooter, PublicHeader } from "@/components/public/PublicChrome";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("app.faq.metaTitle"), description: t("app.faq.metaDescription") };
}

const QUESTIONS = ["what", "real", "pay", "price", "phone", "trade", "rules", "reset", "fail", "kyc", "payout", "refund", "language", "support"] as const;
type Question = (typeof QUESTIONS)[number];

export default async function FaqPage() {
  const [t, templates] = await Promise.all([getT(), listActiveTemplatesForStorefront()]);
  const cheapest = templates.length > 0 ? templates.reduce((min, tpl) => (tpl.price < min.price ? tpl : min)) : null;

  const answer = (q: Question): string => {
    if (q === "price") {
      return cheapest ? t("app.faq.a.price", { price: formatCurrency(cheapest.price, cheapest.currency) }) : t("app.faq.a.priceNone");
    }
    if (q === "payout") return t("app.faq.a.payout", { days: MIN_FUNDED_DAYS_BEFORE_PAYOUT, min: formatCurrency(MIN_PAYOUT_ETB, "ETB") });
    return t(`app.faq.a.${q}`);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <PublicHeader />

      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-3xl font-semibold sm:text-4xl">{t("app.faq.title")}</h1>
        <p className="mt-3 leading-relaxed text-muted">{t("app.faq.intro")}</p>

        <div className="mt-8 flex flex-col gap-3">
          {QUESTIONS.map((q) => (
            <details key={q} id={q} className="card group scroll-mt-6 p-0 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-[0.9rem] px-5 py-4 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-2">
                <span>{t(`app.faq.q.${q}`)}</span>
                <span className="shrink-0 text-muted transition group-open:rotate-45" aria-hidden>
                  +
                </span>
              </summary>
              <div className="px-5 pb-5 text-sm leading-relaxed text-muted">
                <p>{answer(q)}</p>
                {q === "rules" && (
                  <Link href="/rules" className="mt-2 inline-block text-accent-2 hover:underline">
                    {t("common.nav.rules")} →
                  </Link>
                )}
              </div>
            </details>
          ))}
        </div>

        <div className="card mt-12 flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">{t("app.public.ctaTitle")}</h2>
            <p className="text-sm text-muted">{t("app.public.ctaBody")}</p>
          </div>
          <div className="flex gap-2">
            <Link href="/register" className="btn-primary">
              {t("app.landing.ctaStart")}
            </Link>
            <Link href="/rules" className="btn-secondary">
              {t("common.nav.rules")}
            </Link>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
