"use client";

import { clsx } from "clsx";

export type Column<T> = {
  header: string;
  key: string;
  render: (row: T) => React.ReactNode;
  className?: string;
};

export function DataTable<T>({
  columns,
  rows,
  loading,
  error,
  emptyTitle = "No records found",
  emptyDescription = "Try adjusting your search or filters.",
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  error?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  rowKey: (row: T) => string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
            {columns.map((col) => (
              <th key={col.key} className={clsx("px-4 py-3 font-medium", col.className)}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={`skeleton-${i}`} className="border-b border-border/60">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3">
                    <div className="h-4 w-full max-w-[140px] animate-pulse rounded bg-white/5" />
                  </td>
                ))}
              </tr>
            ))}

          {!loading && error && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-danger">
                {error}
              </td>
            </tr>
          )}

          {!loading && !error && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-14 text-center">
                <div className="text-sm font-medium text-foreground">{emptyTitle}</div>
                <div className="mt-1 text-xs text-muted">{emptyDescription}</div>
              </td>
            </tr>
          )}

          {!loading &&
            !error &&
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-border/60 last:border-0 hover:bg-white/[0.03]">
                {columns.map((col) => (
                  <td key={col.key} className={clsx("px-4 py-3 align-middle", col.className)}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
