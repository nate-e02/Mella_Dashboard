"use client";

import { useT } from "@/i18n/client";

function Line({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-surface-2 ${className}`} aria-hidden="true" />;
}

function CardSkeleton() {
  return (
    <div className="card flex flex-col gap-4 p-4" aria-hidden="true">
      <div className="flex justify-between">
        <Line className="h-4 w-40" />
        <Line className="h-5 w-16 rounded-full" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Line className="h-8" />
        <Line className="h-8" />
        <Line className="h-8" />
      </div>
      <Line className="h-2 w-full rounded-full" />
      <Line className="h-2 w-full rounded-full" />
      <Line className="h-2 w-full rounded-full" />
      <div className="flex gap-2">
        <Line className="h-8 w-28" />
        <Line className="h-8 w-28" />
      </div>
    </div>
  );
}

export default function DashboardLoading() {
  const t = useT();
  return (
    <div className="flex flex-col gap-6" role="status" aria-label={t("app.loading.dashboard")}>
      <div>
        <Line className="h-7 w-40" />
        <Line className="mt-2 h-4 w-64" />
      </div>
      <div className="card grid grid-cols-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="px-4 py-3">
            <Line className="h-3 w-16" />
            <Line className="mt-2 h-6 w-20" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <span className="sr-only">{t("common.loading")}</span>
    </div>
  );
}
