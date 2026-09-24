import { adminMfaRequired } from "@/lib/auth/guards";
import { requireTraderPage } from "@/lib/auth/pageGuards";
import { prisma } from "@/lib/prisma";
import { ChangePasswordForm } from "@/components/shared/ChangePasswordForm";
import { MfaSettings } from "@/components/shared/MfaSettings";
import { KycSubmissionCard } from "@/components/trader/KycSubmissionCard";
import { EmailVerificationCard } from "@/components/trader/account/EmailVerificationCard";
import { PayoutRequestCard } from "@/components/trader/account/PayoutRequestCard";
import { SupportTicketsCard } from "@/components/trader/account/SupportTicketsCard";
import { formatDate } from "@/lib/format";
import type { TemplateSnapshot } from "@/types";

export const dynamic = "force-dynamic";

export default async function TraderAccountPage() {
  const sessionUser = await requireTraderPage();
  const [user, fundedAccounts] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: sessionUser.id },
      include: { kycSubmissions: { orderBy: { submittedAt: "desc" }, take: 1 } },
    }),
    prisma.tradingAccount.findMany({ where: { userId: sessionUser.id, status: "FUNDED" }, select: { id: true, snapshot: true }, orderBy: { createdAt: "desc" } }),
  ]);
  void adminMfaRequired;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Account</h1>
        <p className="text-sm text-muted">Manage your profile, verification, security, payouts and support.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold">Profile</h3>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted">Name</dt>
            <dd className="text-right font-medium">{user.name}</dd>
            <dt className="text-muted">Email</dt>
            <dd className="text-right font-medium">{user.email ?? "—"}</dd>
            <dt className="text-muted">Phone</dt>
            <dd className="text-right font-medium">{user.phone ?? "—"}</dd>
            <dt className="text-muted">Member Since</dt>
            <dd className="text-right font-medium">{formatDate(user.createdAt)}</dd>
          </dl>
        </div>
        {user.email && <EmailVerificationCard email={user.email} verified={!!user.emailVerifiedAt} />}
        <KycSubmissionCard
          latest={
            user.kycSubmissions[0]
              ? {
                  id: user.kycSubmissions[0].id,
                  status: user.kycSubmissions[0].status,
                  submittedAt: user.kycSubmissions[0].submittedAt.toISOString(),
                  failureReason: user.kycSubmissions[0].failureReason,
                }
              : null
          }
        />
        <MfaSettings enabled={user.mfaEnabled} required={false} />
      </div>

      <PayoutRequestCard fundedAccounts={fundedAccounts.map((a) => ({ id: a.id, name: (a.snapshot as unknown as TemplateSnapshot).name ?? a.id }))} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChangePasswordForm />
        <SupportTicketsCard />
      </div>
    </div>
  );
}
