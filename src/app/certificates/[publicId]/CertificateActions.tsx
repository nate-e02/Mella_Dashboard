"use client";

import { ShareLinks } from "@/components/trader/growth/ShareLinks";
import { useT } from "@/i18n/client";

export function CertificateActions({ url, shareText }: { url: string; shareText: string }) {
  const t = useT();
  return (
    <div className="certificate-no-print flex w-full max-w-4xl flex-col items-center gap-3 sm:flex-row sm:justify-between">
      <ShareLinks url={url} text={shareText} showUrl={false} />
      <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => window.print()}>
        {t("growth.certificate.print")}
      </button>
    </div>
  );
}
