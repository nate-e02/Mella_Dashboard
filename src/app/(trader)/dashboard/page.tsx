import Link from "next/link";
import { getT } from "@/i18n/server";
import { requireTrader } from "@/lib/auth/guards";
import { listUserAccountStates } from "@/lib/services/accountState";
import { ObjectivesCard } from "@/components/trader/dashboard/ObjectivesCard";
import { SummaryStrip } from "@/components/trader/dashboard/SummaryStrip";
import { roundCurrency } from "@/lib/services/calculations";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("trading.dashboard.metaTitle") };
}

export default async function TraderDashboardPage() {
  const user = await requireTrader();
  const [entries, t] = await Promise.all([listUserAccountStates(user.id), getT()]);
  const now = new Date();

  const fundedCount = entries.filter((e) => e.meta.status === "FUNDED").length;
  const activeCount = entries.filter((e) => e.meta.status === "ACTIVE").length;
  const totalRealizedPnl = roundCurrency(entries.reduce((sum, e) => sum + e.state.realizedPnl, 0));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{t("common.nav.dashboard")}</h1>
          <p className="text-sm text-muted">{t("trading.dashboard.subtitle")}</p>
        </div>
        {entries.some((e) => e.meta.tradable) && (
          <Link href="/trade" className="btn-primary !py-1.5 text-sm">
            {t("trading.objectives.openTerminal")}
          </Link>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-sm font-medium">{t("trading.dashboard.emptyTitle")}</div>
          <div className="mt-1 text-xs text-muted">
            {t("trading.dashboard.emptyBefore")}{" "}
            <Link href="/challenges" className="text-accent-2 underline">
              {t("common.nav.challenges")}
            </Link>{" "}
            {t("trading.dashboard.emptyAfter")}
          </div>
        </div>
      ) : (
        <>
          <SummaryStrip accountsCount={entries.length} fundedCount={fundedCount} activeCount={activeCount} totalRealizedPnl={totalRealizedPnl} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {entries.map((entry) => (
              <ObjectivesCard key={entry.meta.id} entry={entry} now={now} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
