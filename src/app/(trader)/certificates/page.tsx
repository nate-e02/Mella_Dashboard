import type { Metadata } from "next";
import Link from "next/link";
import { requireTraderPage } from "@/lib/auth/pageGuards";
import { listCertificatesForUser } from "@/lib/services/certificates";
import { appUrl } from "@/env";
import { Badge } from "@/components/ui/Badge";
import { ShareLinks } from "@/components/trader/growth/ShareLinks";
import { certificateText, formatCertificateDate } from "@/lib/growth/certificateText";
import { getLocale, getT } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("growth.certificates.metaTitle") };
}

const TYPE_TONE = { CHALLENGE_PASSED: "info", FUNDED: "success", PAYOUT: "warning" } as const;

export default async function CertificatesPage() {
  const [user, t, locale] = await Promise.all([requireTraderPage(), getT(), getLocale()]);
  const certificates = await listCertificatesForUser(user.id);
  const base = appUrl();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("growth.certificates.title")}</h1>
        <p className="text-sm text-muted">{t("growth.certificates.subtitle")}</p>
      </div>

      {certificates.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-sm font-medium">{t("growth.certificates.empty.title")}</div>
          <div className="mt-1 text-xs text-muted">{t("growth.certificates.empty.body")}</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {certificates.map((c) => {
            const text = certificateText(t, c);
            const url = `${base}/certificates/${c.publicId}`;
            return (
              <div key={c.id} className="card flex flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Badge tone={TYPE_TONE[c.type]}>{t(`growth.certificate.type.${c.type}`)}</Badge>
                    <h2 className="mt-2 text-base font-semibold">{text.title}</h2>
                    <p className="text-xs text-muted">{t("growth.certificate.issued", { date: formatCertificateDate(c.issuedAt, locale) })}</p>
                  </div>
                  <Link href={`/certificates/${c.publicId}`} target="_blank" className="btn-secondary shrink-0 !py-1.5 text-xs">
                    {t("growth.certificates.open")}
                  </Link>
                </div>
                <ShareLinks url={url} text={t("growth.certificates.shareText", { title: text.title })} showUrl={false} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
