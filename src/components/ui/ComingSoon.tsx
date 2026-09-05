export function ComingSoon({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-2/20 to-accent/20 text-2xl">
        🚧
      </div>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">{description ?? "This module is coming soon."}</p>
      <span className="mt-4 inline-flex items-center rounded-full border border-border bg-surface-2 px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted">
        Coming Soon
      </span>
    </div>
  );
}
