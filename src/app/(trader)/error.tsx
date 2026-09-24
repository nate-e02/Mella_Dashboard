"use client";

import { useEffect } from "react";
import { useT } from "@/i18n/client";

export default function TraderError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  useEffect(() => {
    console.error("page error", error.digest ?? error.message);
  }, [error]);
  return (
    <div className="card mx-auto mt-10 max-w-md p-6 text-center">
      <h2 className="text-lg font-semibold">{t("app.error.title")}</h2>
      <p className="mt-1 text-sm text-muted">{t("app.error.body")}</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted">{t("app.error.reference", { ref: error.digest })}</p>}
      <button className="btn-primary mt-4" onClick={reset}>
        {t("common.retry")}
      </button>
    </div>
  );
}
