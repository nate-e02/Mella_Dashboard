import type { Metadata } from "next";
import Link from "next/link";
import { requireTraderPage } from "@/lib/auth/pageGuards";
import { listPurchasesForUser } from "@/lib/services/purchases";
import { StatusBadge } from "@/components/ui/Badge";
import { formatCurrency, formatDateTime, formatSigned } from "@/lib/format";
import { PurchaseReturnHandler } from "@/components/trader/PurchaseReturnHandler";
import { getT } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("growth.purchases.metaTitle") };
}

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ tx_ref?: string }> }) {
  const [user, { tx_ref: txRef }, t] = await Promise.all([requireTraderPage(), searchParams, getT()]);
  const purchases = await listPurchasesForUser(user.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("growth.purchases.title")}</h1>
        <p className="text-sm text-muted">{t("growth.purchases.subtitle")}</p>
      </div>

      {txRef && <PurchaseReturnHandler txRef={txRef} />}

      {purchases.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-sm font-medium">{t("growth.purchases.empty.title")}</div>
          <div className="mt-1 text-xs text-muted">
            {t("growth.purchases.empty.before")}{" "}
            <Link href="/challenges" className="text-accent-2 underline">
              {t("common.nav.challenges")}
            </Link>{" "}
            {t("growth.purchases.empty.after")}
          </div>
        </div>
      ) : (
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">{t("growth.purchases.col.template")}</th>
                <th className="px-4 py-3">{t("growth.purchases.col.paid")}</th>
                <th className="px-4 py-3">{t("growth.purchases.col.phase")}</th>
                <th className="px-4 py-3">{t("growth.purchases.col.balance")}</th>
                <th className="px-4 py-3">{t("growth.purchases.col.pnl")}</th>
                <th className="px-4 py-3">{t("common.status")}</th>
                <th className="px-4 py-3">{t("growth.purchases.col.purchased")}</th>
                <th className="px-4 py-3">
                  <span className="sr-only">{t("growth.purchases.col.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => {
                const account = p.tradingAccount;
                const pnl = account ? account.balance - account.startingBalance : 0;
                const discounted = p.discountAmount > 0 && p.listPrice != null;
                return (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3">{p.template?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{p.amount > 0 ? formatCurrency(p.amount, p.currency) : t("growth.purchases.free")}</div>
                      {discounted && (
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          <span className="line-through">{formatCurrency(p.listPrice!, p.currency)}</span>
                          <span className="text-success">
                            {p.coupon
                              ? t("growth.purchases.discountWithCode", { amount: formatCurrency(p.discountAmount, p.currency), code: p.coupon.code })
                              : t("growth.purchases.discount", { amount: formatCurrency(p.discountAmount, p.currency) })}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">{account ? t(`growth.phase.${account.phase}` as MessageKey) : "—"}</td>
                    <td className="px-4 py-3">{account ? formatCurrency(account.balance, "ETB") : "—"}</td>
                    <td className={`px-4 py-3 ${pnl >= 0 ? "text-success" : "text-danger"}`}>{account ? formatSigned(pnl, "ETB") : "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={account?.status ?? p.status} />
                    </td>
                    <td className="px-4 py-3">{formatDateTime(p.createdAt)}</td>
                    <td className="px-4 py-3">
                      {account && (
                        <Link href={`/accounts/${account.id}`} className="btn-ghost !px-2 !py-1 text-xs">
                          {t("growth.purchases.view")}
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
