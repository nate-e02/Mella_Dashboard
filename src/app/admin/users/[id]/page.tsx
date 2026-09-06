import { notFound } from "next/navigation";
import Link from "next/link";
import { getUserDetail } from "@/lib/services/users";
import { StatusBadge } from "@/components/ui/Badge";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUserDetail(id);
  if (!user) notFound();

  const totalRevenue = user.purchases.filter((p) => p.status === "PAID").reduce((s, p) => s + p.amount, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/users" className="text-xs text-muted hover:text-foreground">
          ← Back to Users
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{user.name}</h1>
          <StatusBadge status={user.status} />
          <StatusBadge status={user.role} />
        </div>
        <p className="text-sm text-muted">{user.email}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MiniStat label="Accounts" value={user.tradingAccounts.length} />
        <MiniStat label="Purchases" value={user.purchases.length} />
        <MiniStat label="Total Revenue" value={formatCurrency(totalRevenue)} />
        <MiniStat label="Joined" value={formatDate(user.createdAt)} />
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold">Trading Accounts</div>
        <table className="w-full min-w-[600px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">Template</th>
              <th className="px-4 py-2.5">Phase</th>
              <th className="px-4 py-2.5">Balance</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Created</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {user.tradingAccounts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">
                  No trading accounts yet.
                </td>
              </tr>
            )}
            {user.tradingAccounts.map((a) => (
              <tr key={a.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2.5">{a.template?.name ?? "—"}</td>
                <td className="px-4 py-2.5">{a.phase.replace("_", " ")}</td>
                <td className="px-4 py-2.5">{formatCurrency(a.balance)}</td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={a.status} />
                </td>
                <td className="px-4 py-2.5">{formatDate(a.createdAt)}</td>
                <td className="px-4 py-2.5">
                  <Link href={`/admin/accounts/${a.id}`} className="btn-ghost !px-2 !py-1 text-xs">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold">Purchases</div>
        <table className="w-full min-w-[600px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">Template</th>
              <th className="px-4 py-2.5">Amount</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Transaction ID</th>
              <th className="px-4 py-2.5">Date</th>
            </tr>
          </thead>
          <tbody>
            {user.purchases.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted">
                  No purchases yet.
                </td>
              </tr>
            )}
            {user.purchases.map((p) => (
              <tr key={p.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2.5">{p.template?.name ?? "—"}</td>
                <td className="px-4 py-2.5">{formatCurrency(p.amount, p.currency)}</td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={p.status} />
                </td>
                <td className="px-4 py-2.5 font-mono text-xs">{p.providerTxRef}</td>
                <td className="px-4 py-2.5">{formatDateTime(p.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card !p-0 overflow-hidden">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold">KYC Submissions</div>
        <table className="w-full min-w-[500px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2.5">Full Name</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Submitted</th>
              <th className="px-4 py-2.5">Reviewed</th>
            </tr>
          </thead>
          <tbody>
            {user.kycSubmissions.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted">
                  No KYC submissions.
                </td>
              </tr>
            )}
            {user.kycSubmissions.map((k) => (
              <tr key={k.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2.5">{k.fullName}</td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={k.status} />
                </td>
                <td className="px-4 py-2.5">{formatDateTime(k.submittedAt)}</td>
                <td className="px-4 py-2.5">{formatDateTime(k.reviewedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}
