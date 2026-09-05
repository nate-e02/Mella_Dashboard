import { getSessionUser } from "@/lib/auth/session";
import { ChangePasswordForm } from "@/components/shared/ChangePasswordForm";

export default async function AdminSettingsPage() {
  const user = await getSessionUser();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">Manage your admin profile and credentials.</p>
      </div>

      <div className="card max-w-md p-5">
        <h3 className="mb-3 text-sm font-semibold">Profile</h3>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted">Name</dt>
          <dd className="text-right font-medium">{user?.name}</dd>
          <dt className="text-muted">Email</dt>
          <dd className="text-right font-medium">{user?.email}</dd>
          <dt className="text-muted">Role</dt>
          <dd className="text-right font-medium">{user?.role}</dd>
        </dl>
      </div>

      <ChangePasswordForm />
    </div>
  );
}
