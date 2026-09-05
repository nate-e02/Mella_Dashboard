import { getOverviewStats, getRevenueSeries, getSignupSeries } from "@/lib/services/stats";
import { StatCard } from "@/components/ui/Card";
import { RevenueAreaChart, SignupBarChart } from "@/components/ui/Charts";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const [user, stats, revenueSeries, signupSeries] = await Promise.all([
    getSessionUser(),
    getOverviewStats(),
    getRevenueSeries(30),
    getSignupSeries(30),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Good {greeting()}</h1>
        <p className="text-sm text-muted">Real-time overview · {user?.name}</p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Revenue</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Revenue Today" value={formatCurrency(stats.revenueToday)} />
          <StatCard label="This Month" value={formatCurrency(stats.revenueMonth)} sublabel="Month to date" />
          <StatCard label="New Signups" value={formatNumber(stats.newSignupsToday)} sublabel="Today" />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Revenue (last 30 days)</h3>
          <RevenueAreaChart data={revenueSeries} />
        </div>
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold text-foreground">New Signups (last 30 days)</h3>
          <SignupBarChart data={signupSeries} />
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">B-Book Overview</h2>
        <p className="mb-3 text-xs text-muted">Your firm holds the other side of every challenge — these are the numbers that move your edge.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Active Funded Accounts" value={formatNumber(stats.activeFundedAccounts)} sublabel="Live funded books trading" />
          <StatCard label="Funded Capital Deployed" value={formatCurrency(stats.fundedCapitalDeployed)} sublabel="Notional size of active funded books" />
          <StatCard
            label="Total Funded P&L"
            value={formatCurrency(stats.totalFundedPnl)}
            sublabel="Traders up vs firm risk"
            tone={stats.totalFundedPnl >= 0 ? "success" : "danger"}
          />
          <StatCard label="Phase 1 Pass Rate" value={formatPercent(stats.phase1PassRate)} sublabel={`${stats.phase1Passed}/${stats.phase1Total} passed`} />
          <StatCard label="Phase 2 Pass Rate" value={formatPercent(stats.phase2PassRate)} sublabel={`${stats.phase2Passed}/${stats.phase2Total} passed`} />
          <StatCard label="Failed This Week" value={formatNumber(stats.failedThisWeek)} sublabel={`${stats.failedThisMonth} this month`} tone="danger" />
          <StatCard label="Repeat Buyers" value={formatNumber(stats.repeatBuyers)} sublabel={`of ${stats.uniquePayingUsers} buyers`} />
          <StatCard label="Refund Rate (30d)" value={formatPercent(stats.refundRate)} sublabel="of purchases in last 30 days" />
          <StatCard label="Payouts This Month" value={formatCurrency(stats.payoutsThisMonthSum)} sublabel={`${stats.payoutsThisMonthCount} payouts`} />
          <StatCard label="Avg Payout Size" value={formatCurrency(stats.avgPayoutSize)} sublabel="All completed payouts" />
          <StatCard label="Chargeback Rate (30d)" value={formatPercent(stats.chargebackRate)} sublabel="0 chargebacks" />
          <StatCard label="Revenue per User (LTV)" value={formatCurrency(stats.revenuePerUser)} sublabel="All-time revenue ÷ paying users" />
          <StatCard label="Largest Funded P&L" value={formatCurrency(stats.largestFundedPnl)} sublabel="Top single funded account" />
          <StatCard label="Approaching Payout" value={formatNumber(stats.fundedApproachingPayout)} sublabel="Funded accounts near payout threshold" />
          <StatCard label="Promo Discounts" value={formatCurrency(stats.promoDiscounts)} sublabel="No active promotions" />
        </div>
      </section>
    </div>
  );
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}
