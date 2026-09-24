import { adminMfaRequired } from "@/lib/auth/guards";
import { requireTraderPage } from "@/lib/auth/pageGuards";
import { prisma } from "@/lib/prisma";
import { ChangePasswordForm } from "@/components/shared/ChangePasswordForm";
import { MfaSettings } from "@/components/shared/MfaSettings";
import { KycSubmissionCard } from "@/components/trader/KycSubmissionCard";
import { EmailVerificationCard } from "@/components/trader/account/EmailVerificationCard";
import { AddEmailCard } from "@/components/trader/account/AddEmailCard";
import { PhoneCard } from "@/components/trader/account/PhoneCard";
import { SetPasswordCard } from "@/components/trader/account/SetPasswordCard";
import { PayoutRequestCard } from "@/components/trader/account/PayoutRequestCard";
import { SupportTicketsCard } from "@/components/trader/account/SupportTicketsCard";
import { formatDate } from "@/lib/format";
import { formatPhone, maskPhone } from "@/lib/phone";
import { getT } from "@/i18n/server";
import type { TemplateSnapshot } from "@/types";

export const dynamic = "force-dynamic";

export default async function TraderAccountPage() {
  const [sessionUser, t] = await Promise.all([requireTraderPage(), getT()]);
  const [user, fundedAccounts] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: sessionUser.id },
      include: { kycSubmissions: { orderBy: { submittedAt: "desc" }, take: 1 } },
    }),
    prisma.tradingAccount.findMany({ where: { userId: sessionUser.id, status: "FUNDED" }, select: { id: true, snapshot: true }, orderBy: { createdAt: "desc" } }),
  ]);
  void adminMfaRequired;
  // Only whether a password exists ever reaches the client, never the hash.
  const hasPassword = !!user.passwordHash;
  const phoneVerified = !!(user.phone && user.phoneVerifiedAt);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("auth.account.title")}</h1>
        <p className="text-sm text-muted">{t("auth.account.subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-3 text-sm font-semibold">{t("auth.account.profile")}</h3>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted">{t("auth.account.name")}</dt>
            <dd className="text-right font-medium">{user.name}</dd>
            <dt className="text-muted">{t("auth.account.email")}</dt>
            <dd className="break-all text-right font-medium">{user.email ?? "—"}</dd>
            <dt className="text-muted">{t("auth.account.phone")}</dt>
            <dd className="text-right font-medium">
              {user.phone ? formatPhone(user.phone) : "—"}
              {user.phone && <span className={`ml-2 text-xs ${phoneVerified ? "text-success" : "text-warning"}`}>{phoneVerified ? `✓ ${t("auth.verified")}` : t("auth.notVerified")}</span>}
            </dd>
            <dt className="text-muted">{t("auth.account.memberSince")}</dt>
            <dd className="text-right font-medium">{formatDate(user.createdAt)}</dd>
          </dl>
        </div>
        <PhoneCard phone={user.phone} verified={phoneVerified} />
        {user.email ? <EmailVerificationCard email={user.email} verified={!!user.emailVerifiedAt} /> : <AddEmailCard />}
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
        <MfaSettings enabled={user.mfaEnabled} required={false} hasPassword={hasPassword} />
      </div>

      <PayoutRequestCard fundedAccounts={fundedAccounts.map((a) => ({ id: a.id, name: (a.snapshot as unknown as TemplateSnapshot).name ?? a.id }))} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {hasPassword ? <ChangePasswordForm /> : <SetPasswordCard maskedPhone={phoneVerified && user.phone ? maskPhone(user.phone) : null} />}
        <SupportTicketsCard />
      </div>
    </div>
  );
}
