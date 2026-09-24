import type { CertificateType } from "@prisma/client";
import type { MessageKey } from "@/i18n/messages";
import type { CertificateMetadata } from "@/lib/services/certificates";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** "1,000,000 ETB Standard 2-Step" - the account described on a certificate. */
function accountLabel(meta: CertificateMetadata): string {
  if (!meta.accountSize) return meta.program ?? "";
  const size = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(meta.accountSize);
  return `${size} ${meta.accountCurrency ?? "ETB"}${meta.program ? ` ${meta.program}` : ""}`;
}

function amountLabel(amount: number | null, currency: string): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount ?? 0)} ${currency}`;
}

/**
 * Translated headline and sentence for a certificate, rebuilt from its type
 * and metadata so the same certificate reads naturally in English and
 * Amharic (the stored `title` is the English fallback).
 */
export function certificateText(t: Translate, cert: { type: CertificateType; title: string; amount: number | null; currency: string; metadata: unknown }) {
  const meta = (cert.metadata ?? {}) as CertificateMetadata;
  const account = accountLabel(meta);
  const phase = meta.phase ? t(`growth.phase.${meta.phase}` as MessageKey) : "";
  switch (cert.type) {
    case "CHALLENGE_PASSED":
      return {
        kind: t("growth.certificate.kind.achievement"),
        title: account ? t("growth.certificate.title.passed", { phase, account }) : cert.title,
        statement: t("growth.certificate.statement.passed", { phase, account }),
      };
    case "FUNDED":
      return {
        kind: t("growth.certificate.kind.achievement"),
        title: account ? t("growth.certificate.title.funded", { account }) : cert.title,
        statement: t("growth.certificate.statement.funded", { account }),
      };
    case "PAYOUT": {
      const amount = amountLabel(cert.amount, cert.currency);
      return {
        kind: t("growth.certificate.kind.payout"),
        title: t("growth.certificate.title.payout", { amount }),
        statement: t("growth.certificate.statement.payout", { amount }),
      };
    }
  }
}

/** Issue date in East Africa Time, in the viewer's language. */
export function formatCertificateDate(date: Date, locale: string): string {
  const tag = locale === "am" ? "am-ET" : "en-US";
  return date.toLocaleDateString(tag, { year: "numeric", month: "long", day: "numeric", timeZone: "Africa/Addis_Ababa" });
}
