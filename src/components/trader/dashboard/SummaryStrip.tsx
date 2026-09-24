import { clsx } from "clsx";
import { etb, pnlClass, signedEtb } from "./money";

export function SummaryStrip({ accountsCount, fundedCount, activeCount, totalRealizedPnl }: { accountsCount: number; fundedCount: number; activeCount: number; totalRealizedPnl: number }) {
  const items: { label: string; value: string; className?: string }[] = [
    { label: "Accounts", value: String(accountsCount) },
    { label: "In challenge", value: String(activeCount) },
    { label: "Funded", value: String(fundedCount), className: fundedCount > 0 ? "text-success" : undefined },
    { label: "Realized P&L", value: totalRealizedPnl === 0 ? etb(0) : signedEtb(totalRealizedPnl), className: pnlClass(totalRealizedPnl) },
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
