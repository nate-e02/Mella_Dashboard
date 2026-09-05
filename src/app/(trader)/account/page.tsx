import { requireTrader } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { ChangePasswordForm } from "@/components/shared/ChangePasswordForm";
import { KycSubmissionCard } from "@/components/trader/KycSubmissionCard";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TraderAccountPage() {
  const sessionUser = await requireTrader();
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: sessionUser.id },
    include: { kycSubmissions: { orderBy: { submittedAt: "desc" }, take: 1 } },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Account</h1>
        <p className="text-sm text-muted">Manage your profile, verification, and security.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold">Profile</h3>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted">Name</dt>
            <dd className="text-right font-medium">{user.name}</dd>
            <dt className="text-muted">Email</dt>
            <dd className="text-right font-medium">{user.email}</dd>
            <dt className="text-muted">Member Since</dt>
            <dd className="text-right font-medium">{formatDate(user.createdAt)}</dd>
          </dl>
        </div>

        <KycSubmissionCard latest={user.kycSubmissions[0] ? { ...user.kycSubmissions[0], submittedAt: user.kycSubmissions[0].submittedAt.toISOString() } : null} />
      </div>

      <ChangePasswordForm />
    </div>
  );
}
