import { clsx } from "clsx";

export type MeterTone = "accent" | "success" | "warning" | "danger";

/**
 * Compact labelled progress meter used by the objectives cards and the
 * terminal account rail. `percent` is clamped to 0..100; `tone` is chosen by
 * the caller so "80% of your daily loss used" can be red while "80% of the
 * profit target reached" is green.
 */
export function MeterBar({
  label,
  percent,
  tone = "accent",
  left,
  right,
  size = "md",
  ariaLabel,
}: {
  label: string;
  percent: number;
  tone?: MeterTone;
  /** Text under the bar, left side (e.g. "1,250 used"). */
  left?: string;
  /** Text under the bar, right side (e.g. "of 5,000"). */
  right?: string;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  const pct = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  const fill =
    tone === "danger" ? "bg-danger" : tone === "warning" ? "bg-warning" : tone === "success" ? "bg-success" : "bg-gradient-to-r from-accent-2 to-accent";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="text-muted">{label}</span>
        <span className={clsx("font-medium tabular-nums", tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-foreground")}>
          {Math.round(pct)}%
        </span>
      </div>
      <div
        className={clsx("w-full overflow-hidden rounded-full bg-surface-2", size === "sm" ? "h-1.5" : "h-2")}
        role="progressbar"
        aria-label={ariaLabel ?? label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div className={clsx("h-full rounded-full transition-[width] duration-300", fill)} style={{ width: `${pct}%` }} />
      </div>
      {(left || right) && (
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] tabular-nums text-muted">
          <span>{left}</span>
          <span>{right}</span>
        </div>
      )}
    </div>
  );
}

/** Tone for a "budget used" meter: red past 80%, amber past 50%. */
export function budgetTone(percentUsed: number): MeterTone {
  if (percentUsed >= 80) return "danger";
  if (percentUsed >= 50) return "warning";
  return "accent";
}
