import type { Metadata } from "next";
import { requireTraderPage } from "@/lib/auth/pageGuards";
import { getReferralOverview } from "@/lib/services/referrals";
import { appUrl } from "@/env";
import { StatCard } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { ShareLinks } from "@/components/trader/growth/ShareLinks";
import { formatCurrency, formatDate } from "@/lib/format";
import { getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("growth.referrals.metaTitle") };
}

export default async function ReferralsPage() {
  const [user, t] = await Promise.all([requireTraderPage(), getT()]);
  const overview = await getReferralOverview(user.id);
  const link = `${appUrl()}/r/${overview.code}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("growth.referrals.title")}</h1>
        <p className="text-sm text-muted">{t("growth.referrals.subtitle", { percent: overview.percent })}</p>
      </div>

      <div className="card flex flex-col gap-4 p-5">
        <div>
          <h2 className="text-sm font-semibold">{t("growth.referrals.linkTitle")}</h2>
          <p className="text-xs text-muted">
            {t("growth.referrals.codeLabel")} <span className="font-mono font-semibold text-foreground">{overview.code}</span>
          </p>
        </div>
        <ShareLinks url={link} text={t("growth.referrals.shareText")} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label={t("growth.referrals.stat.signups")} value={overview.signups} />
        <StatCard label={t("growth.referrals.stat.paying")} value={overview.payingReferrals} />
        <StatCard label={t("growth.referrals.stat.pending")} value={formatCurrency(overview.earnings.pending)} tone="warning" />
        <StatCard label={t("growth.referrals.stat.approved")} value={formatCurrency(overview.earnings.approved)} />
        <StatCard label={t("growth.referrals.stat.paid")} value={formatCurrency(overview.earnings.paid)} tone="success" />
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">{t("growth.referrals.rewardsTitle")}</h2>
        </div>
        {overview.rewards.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="text-sm font-medium">{t("growth.referrals.empty.title")}</div>
            <div className="mt-1 text-xs text-muted">{t("growth.referrals.empty.body")}</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5">{t("growth.referrals.col.trader")}</th>
                  <th className="px-4 py-2.5">{t("growth.referrals.col.reward")}</th>
                  <th className="px-4 py-2.5">{t("common.status")}</th>
                  <th className="px-4 py-2.5">{t("common.date")}</th>
                </tr>
              </thead>
              <tbody>
                {overview.rewards.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5">{r.referredName}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{formatCurrency(r.amount, r.currency)}</span>
                      <span className="ml-1 text-xs text-muted">({r.percent}%)</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-2.5">{formatDate(r.paidAt ?? r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card p-5 text-sm">
        <h2 className="mb-2 font-semibold">{t("growth.referrals.terms.title")}</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>{t("growth.referrals.terms.commission", { percent: overview.percent })}</li>
          <li>{t("growth.referrals.terms.cookie")}</li>
          <li>{t("growth.referrals.terms.payout")}</li>
          <li>{t("growth.referrals.terms.void")}</li>
        </ul>
      </div>
    </div>
  );
}
