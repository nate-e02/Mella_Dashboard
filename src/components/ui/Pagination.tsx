"use client";

import { useT } from "@/i18n/client";

export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  const t = useT();
  if (totalPages <= 1) return null;
  return (
    <nav aria-label={t("common.pagination.label")} className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
      <span className="text-muted">{t("common.pagination.pageOf", { page, total: totalPages })}</span>
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          {t("common.pagination.previous")}
        </button>
        <button className="btn-secondary" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          {t("common.pagination.next")}
        </button>
      </div>
    </nav>
  );
}
