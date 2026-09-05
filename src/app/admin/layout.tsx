import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { AdminShell } from "@/components/admin/AdminShell";
import { ToastProvider } from "@/components/ui/Toast";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/admin");
  if (user.role !== "ADMIN") redirect("/dashboard");

  return (
    <ToastProvider>
      <AdminShell email={user.email}>{children}</AdminShell>
    </ToastProvider>
  );
}
