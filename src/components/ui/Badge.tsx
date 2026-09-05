import { clsx } from "clsx";

type BadgeTone = "default" | "success" | "warning" | "danger" | "info" | "muted";

const toneClasses: Record<BadgeTone, string> = {
  default: "bg-white/10 text-foreground border-white/10",
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-danger/15 text-danger border-danger/30",
  info: "bg-accent-2/15 text-accent-2 border-accent-2/30",
  muted: "bg-white/5 text-muted border-white/10",
};

export function Badge({ tone = "default", children, className }: { tone?: BadgeTone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, BadgeTone> = {
  ACTIVE: "info",
  PASSED: "success",
  FAILED: "danger",
  SUSPENDED: "warning",
  FROZEN: "muted",
  FUNDED: "success",
  DRAFT: "muted",
  INACTIVE: "muted",
  ARCHIVED: "muted",
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  PAID: "success",
  REFUNDED: "warning",
  CANCELLED: "muted",
  NEW: "info",
  QUALIFIED: "info",
  NEGOTIATION: "warning",
  CONVERTED: "success",
  LOST: "danger",
  DISABLED: "danger",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "default"}>{status.replace(/_/g, " ")}</Badge>;
}
