"use client";

import { useT } from "@/i18n/client";

function Block({ className }: { className: string }) {
  return <div className={`card animate-pulse bg-surface-2/60 ${className}`} aria-hidden="true" />;
}

export default function TradeLoading() {
  const t = useT();
  return (
    <div className="flex flex-col gap-3" role="status" aria-label={t("app.loading.trade")}>
      <div className="h-6 w-24 animate-pulse rounded bg-surface-2" />
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)_20rem] lg:items-start">
        <Block className="h-28 lg:col-start-3 lg:row-start-1 lg:h-64" />
        <Block className="h-20 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:h-[520px]" />
        <Block className="h-64 sm:h-80 lg:col-start-2 lg:row-start-1 lg:h-[420px]" />
        <Block className="h-72 lg:col-start-3 lg:row-start-2" />
        <Block className="h-32 lg:col-start-2 lg:row-start-2" />
      </div>
      <span className="sr-only">{t("common.loading")}</span>
    </div>
  );
}
