import { UsersTable } from "@/components/admin/UsersTable";

export default function AdminUsersPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-muted">Manage trader and admin accounts, roles, and access.</p>
      </div>
      <UsersTable />
    </div>
  );
}
