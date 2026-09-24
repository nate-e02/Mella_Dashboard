"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { clsx } from "clsx";
import { useT } from "@/i18n/client";

const noopSubscribe = () => () => {};

/**
 * Copy-link + Telegram / WhatsApp share buttons (plus the phone's native share
 * sheet when the browser has one). Links open the apps' own share pages; no
 * third-party script is loaded.
 */
export function ShareLinks({ url, text, showUrl = true, className }: { url: string; text: string; showUrl?: boolean; className?: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  // False during SSR/hydration so the markup matches, then whether navigator.share exists.
  const canNativeShare = useSyncExternalStore(noopSubscribe, () => typeof navigator !== "undefined" && typeof navigator.share === "function", () => false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard permission denied (e.g. insecure context): select the field so the user can copy it.
      const input = document.getElementById(`share-url-${hash(url)}`) as HTMLInputElement | null;
      input?.select();
    }
  }

  const telegram = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;

  return (
    <div className={clsx("flex flex-col gap-2", className)}>
      {showUrl && (
        <div className="flex gap-2">
          <input
            id={`share-url-${hash(url)}`}
            readOnly
            value={url}
            className="input-base font-mono text-xs"
            aria-label={t("growth.share.link")}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" className="btn-primary shrink-0" onClick={copy} aria-live="polite">
            {copied ? t("common.copied") : t("common.copy")}
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!showUrl && (
          <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={copy} aria-live="polite">
            {copied ? t("common.copied") : t("growth.share.copyLink")}
          </button>
        )}
        <a className="btn-secondary !py-1.5 text-xs" href={telegram} target="_blank" rel="noopener noreferrer">
          {t("growth.share.telegram")}
        </a>
        <a className="btn-secondary !py-1.5 text-xs" href={whatsapp} target="_blank" rel="noopener noreferrer">
          {t("growth.share.whatsapp")}
        </a>
        {canNativeShare && (
          <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => navigator.share({ url, text }).catch(() => undefined)}>
            {t("growth.share.more")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Stable short id for the input element (several share blocks can be on one page). */
function hash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
