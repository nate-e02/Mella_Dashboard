import { AccountsTable } from "@/components/admin/AccountsTable";

export default function AdminAccountsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Trading Accounts</h1>
        <p className="text-sm text-muted">Manage every trader account, its challenge progress, and status.</p>
      </div>
      <AccountsTable />
    </div>
  );
}
