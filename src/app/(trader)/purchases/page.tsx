import Link from "next/link";
import { requireTrader } from "@/lib/auth/guards";
import { listPurchasesForUser } from "@/lib/services/purchases";
import { StatusBadge } from "@/components/ui/Badge";
import { formatCurrency, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAYMENT_BANNERS: Record<string, { tone: string; message: string }> = {
  success: { tone: "border-success/30 bg-success/10 text-success", message: "Payment confirmed — your challenge is now active." },
  pending: { tone: "border-warning/30 bg-warning/10 text-warning", message: "Your payment is still being confirmed. This page will reflect the final status shortly." },
  failed: { tone: "border-danger/30 bg-danger/10 text-danger", message: "Your payment was not completed, so no challenge was activated." },
  error: { tone: "border-danger/30 bg-danger/10 text-danger", message: "We couldn't confirm your payment status. Please check back here in a moment." },
};

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  const user = await requireTrader();
  const purchases = await listPurchasesForUser(user.id);
  const { payment } = await searchParams;
  const banner = payment ? PAYMENT_BANNERS[payment] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">My Purchases</h1>
        <p className="text-sm text-muted">All challenges you have purchased, and their current progress.</p>
      </div>

      {banner && <div className={`card border px-4 py-3 text-sm ${banner.tone}`}>{banner.message}</div>}

      {purchases.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-sm font-medium">No purchases yet.</div>
          <div className="mt-1 text-xs text-muted">
            Head to{" "}
            <Link href="/challenges" className="text-accent-2 underline">
              Challenges
            </Link>{" "}
            to get started.
          </div>
        </div>
      ) : (
        <div className="card !p-0 overflow-hidden">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Template</th>
                <th className="px-4 py-3">Phase</th>
                <th className="px-4 py-3">Balance</th>
                <th className="px-4 py-3">Equity</th>
                <th className="px-4 py-3">P&L</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Purchased</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => {
                const account = p.tradingAccount;
                const pnl = account ? account.balance - account.startingBalance : 0;
                return (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-muted">{account?.id.slice(0, 10) ?? "—"}...</td>
                    <td className="px-4 py-3">{p.template?.name ?? "—"}</td>
                    <td className="px-4 py-3">{account?.phase.replace("_", " ") ?? "—"}</td>
                    <td className="px-4 py-3">{account ? formatCurrency(account.balance) : "—"}</td>
                    <td className="px-4 py-3">{account ? formatCurrency(account.equity) : "—"}</td>
                    <td className={`px-4 py-3 ${pnl >= 0 ? "text-success" : "text-danger"}`}>{account ? formatCurrency(pnl) : "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={account?.status ?? p.status} />
                    </td>
                    <td className="px-4 py-3">{formatDateTime(p.createdAt)}</td>
                    <td className="px-4 py-3">
                      {account && (
                        <Link href={`/accounts/${account.id}`} className="btn-ghost !px-2 !py-1 text-xs">
                          View
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
