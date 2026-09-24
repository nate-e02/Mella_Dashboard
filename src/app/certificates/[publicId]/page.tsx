import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { appUrl } from "@/env";
import { getLocale, getT } from "@/i18n/server";
import { certificateText, formatCertificateDate } from "@/lib/growth/certificateText";
import { loadCertificate } from "./data";
import { CertificateActions } from "./CertificateActions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ publicId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { publicId } = await params;
  const [cert, t] = await Promise.all([loadCertificate(publicId), getT()]);
  if (!cert) return { title: t("growth.certificate.notFound"), robots: { index: false } };
  const text = certificateText(t, cert);
  const title = `${cert.recipientName} — ${text.title}`;
  const description = t("growth.certificate.metaDescription", { name: cert.recipientName, title: text.title });
  const url = `${appUrl()}/certificates/${cert.publicId}`;
  return {
    metadataBase: new URL(appUrl()),
    title: `${title} | MellaFx`,
    description,
    // Shareable, but kept out of search results.
    robots: { index: false, follow: false },
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: "MellaFx", type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

/**
 * Public, unauthenticated verification page for a certificate. Shows only
 * what is printed on it (masked name, achievement, date, id) - never email,
 * phone or internal ids. Printable (A4 landscape) via the print stylesheet.
 */
export default async function PublicCertificatePage({ params }: Props) {
  const { publicId } = await params;
  const [cert, t, locale] = await Promise.all([loadCertificate(publicId), getT(), getLocale()]);
  if (!cert) notFound();

  const text = certificateText(t, cert);
  const url = `${appUrl()}/certificates/${cert.publicId}`;
  const displayUrl = url.replace(/^https?:\/\//, "");
  const serif = { fontFamily: "Georgia, 'Noto Serif', 'Times New Roman', var(--font-ethiopic), serif" };

  return (
    <main className="certificate-page flex min-h-screen flex-col items-center gap-6 bg-background px-4 py-8 sm:py-12">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 0; }
          html, body { background: #fff !important; }
          .certificate-no-print { display: none !important; }
          .certificate-page { padding: 0 !important; min-height: 0 !important; display: block !important; background: #fff !important; }
          .certificate-sheet { box-shadow: none !important; max-width: none !important; width: 100vw; height: 100vh; border-radius: 0 !important; }
          .certificate-sheet * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="certificate-no-print flex w-full max-w-4xl items-center justify-between text-sm">
        <Link href="/" className="font-semibold text-foreground">
          MellaFx
        </Link>
        <span className="rounded-full border border-success/40 bg-success/10 px-3 py-1 text-xs font-medium text-success">✓ {t("growth.certificate.verified")}</span>
      </div>

      <article
        className="certificate-sheet relative w-full max-w-4xl overflow-hidden rounded-lg bg-[#fbf8f1] p-3 text-[#1c1b2e] shadow-2xl sm:p-5"
        aria-label={text.title}
      >
        <div className="flex h-full flex-col border-[3px] border-double border-[#b8913a] px-5 py-8 sm:px-12 sm:py-12">
          <header className="flex flex-col items-center gap-1 text-center">
            <div className="flex items-center gap-2">
              <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
                <path d="M16 2 30 12 16 30 2 12Z" fill="#6d5ef8" />
                <path d="M16 2 23 12 16 30 9 12Z" fill="#3b82f6" opacity=".85" />
              </svg>
              <span className="text-2xl font-bold tracking-tight" style={serif}>
                MellaFx
              </span>
            </div>
            <span className="text-[10px] uppercase tracking-[0.3em] text-[#6b6a7a]">{t("growth.certificate.tagline")}</span>
          </header>

          <div className="mt-8 flex flex-col items-center gap-3 text-center sm:mt-10">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[#b8913a] sm:text-sm">{text.kind}</p>
            <h1 className="max-w-2xl text-2xl font-bold leading-tight sm:text-4xl" style={serif}>
              {text.title}
            </h1>
            <p className="mt-4 text-sm italic text-[#6b6a7a]" style={serif}>
              {t("growth.certificate.certifies")}
            </p>
            <p className="border-b border-[#b8913a]/60 px-6 pb-1 text-3xl font-bold sm:text-5xl" style={serif}>
              {cert.recipientName}
            </p>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#3a3950] sm:text-base">{text.statement}</p>
            {cert.type === "PAYOUT" && cert.amount != null && (
              <p className="mt-1 text-2xl font-bold text-[#1f7a4a] sm:text-3xl" style={serif}>
                {new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cert.amount)} {cert.currency}
              </p>
            )}
          </div>

          <footer className="mt-10 grid grid-cols-1 items-end gap-6 text-center sm:mt-14 sm:grid-cols-3">
            <div>
              <div className="border-t border-[#1c1b2e]/30 pt-2 text-sm font-semibold">{formatCertificateDate(cert.issuedAt, locale)}</div>
              <div className="text-[10px] uppercase tracking-widest text-[#6b6a7a]">{t("growth.certificate.dateIssued")}</div>
            </div>
            <div className="flex justify-center">
              <div className="flex h-24 w-24 flex-col items-center justify-center rounded-full border-4 border-double border-[#b8913a] text-[#b8913a]">
                <span className="text-lg font-bold" style={serif}>
                  M
                </span>
                <span className="text-[8px] font-semibold uppercase tracking-widest">{t("growth.certificate.seal")}</span>
              </div>
            </div>
            <div>
              <div className="border-t border-[#1c1b2e]/30 pt-2 font-mono text-sm font-semibold tracking-wider">{cert.publicId}</div>
              <div className="text-[10px] uppercase tracking-widest text-[#6b6a7a]">{t("growth.certificate.verificationId")}</div>
            </div>
          </footer>

          <p className="mt-8 text-center text-[10px] leading-relaxed text-[#6b6a7a]">
            {t("growth.certificate.verifyAt", { url: displayUrl })}
            <br />
            {t("growth.certificate.disclaimer")}
          </p>
        </div>
      </article>

      <CertificateActions url={url} shareText={t("growth.certificate.shareText", { title: text.title })} />
    </main>
  );
}
