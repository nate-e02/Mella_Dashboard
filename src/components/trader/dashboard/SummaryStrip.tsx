import { clsx } from "clsx";
import { getT } from "@/i18n/server";
import { etb, pnlClass, signedEtb } from "./money";

export async function SummaryStrip({ accountsCount, fundedCount, activeCount, totalRealizedPnl }: { accountsCount: number; fundedCount: number; activeCount: number; totalRealizedPnl: number }) {
  const t = await getT();
  const items: { label: string; value: string; className?: string }[] = [
    { label: t("trading.summary.accounts"), value: String(accountsCount) },
    { label: t("trading.summary.inChallenge"), value: String(activeCount) },
    { label: t("trading.summary.funded"), value: String(fundedCount), className: fundedCount > 0 ? "text-success" : undefined },
    { label: t("trading.realizedPnl"), value: totalRealizedPnl === 0 ? etb(0) : signedEtb(totalRealizedPnl), className: pnlClass(totalRealizedPnl) },
  ];
  return (
    <div className="card grid grid-cols-2 divide-border sm:grid-cols-4 sm:divide-x">
      {items.map((item) => (
        <div key={item.label} className="px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{item.label}</div>
          <div className={clsx("mt-1 text-lg font-semibold tabular-nums", item.className)}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}
