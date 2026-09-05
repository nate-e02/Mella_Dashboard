import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { TraderNav } from "@/components/trader/TraderNav";
import { ToastProvider } from "@/components/ui/Toast";

export default async function TraderLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "TRADER") redirect("/admin");

  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col bg-background">
        <TraderNav />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </ToastProvider>
  );
}
