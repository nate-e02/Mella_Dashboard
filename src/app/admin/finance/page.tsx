import { FinanceExplorer } from "@/components/admin/FinanceExplorer";

export default function AdminFinancePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Finance & Payments</h1>
        <p className="text-sm text-muted">Revenue overview and demo payout management. All payments are simulated — no real payment processor is used.</p>
      </div>
      <FinanceExplorer />
    </div>
  );
}
