import { clsx } from "clsx";

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx("card p-5", className)}>{children}</div>;
}

export function StatCard({
  label,
  value,
  sublabel,
  icon,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sublabel?: string;
  icon?: React.ReactNode;
  tone?: "default" | "success" | "danger" | "warning";
}) {
  const valueColor =
    tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted">
        <span>{label}</span>
        {icon}
      </div>
      <div className={clsx("mt-2 text-2xl font-semibold", valueColor)}>{value}</div>
      {sublabel && <div className="mt-1 text-xs text-muted">{sublabel}</div>}
    </div>
  );
}
