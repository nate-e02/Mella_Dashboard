import Link from "next/link";
import { getT } from "@/i18n/server";
import { requireTrader } from "@/lib/auth/guards";
import { listTradableAccounts } from "@/lib/services/accountState";
import { latestFxRates, listInstruments } from "@/lib/services/market";
import { TradeTerminal } from "@/components/trader/terminal/TradeTerminal";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("trading.page.metaTitle") };
}

export default async function TradePage() {
  const user = await requireTrader();
  const [accounts, instruments, fxRates, t] = await Promise.all([listTradableAccounts(user.id), listInstruments(), latestFxRates("ETB"), getT()]);

  if (accounts.length === 0) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">{t("trading.page.noAccountTitle")}</h1>
        <p className="mt-2 text-sm text-muted">{t("trading.page.noAccountBody")}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/challenges" className="btn-primary">
            {t("trading.page.browseChallenges")}
          </Link>
          <Link href="/purchases" className="btn-secondary">
            {t("common.nav.purchases")}
          </Link>
        </div>
      </div>
    );
  }

  if (instruments.length === 0) {
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <h1 className="text-lg font-semibold">{t("trading.page.noDataTitle")}</h1>
        <p className="mt-2 text-sm text-muted">{t("trading.page.noDataBody")}</p>
        <Link href="/dashboard" className="btn-secondary mt-5">
          {t("trading.page.backToDashboard")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t("common.nav.trade")}</h1>
        <Link href="/dashboard" className="text-xs text-muted hover:text-foreground">
          {t("trading.page.objectivesLink")}
        </Link>
      </div>
      <TradeTerminal accounts={accounts} instruments={instruments} fxRates={fxRates} />
    </div>
  );
}
